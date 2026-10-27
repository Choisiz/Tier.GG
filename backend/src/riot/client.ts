// Riot API 클라이언트: fetch + 제한기 + 재시도 + 오류 분류 (back_spec 3-6, 6-1)
// 키는 X-Riot-Token 헤더로만 보낸다 (URL·로그에 나오지 않음).
import type { RiotClientConfig } from '../config/collection.js';
import type { Logger } from '../lib/logger.js';
import { realClock, type Clock, type RateLimiter } from './rateLimiter.js';
import {
  RiotBadRequestError,
  RiotKeyExpiredError,
  RiotNotFoundError,
  RiotRetryExhaustedError,
} from './errors.js';
import type {
  AccountDto,
  LeagueEntryByPuuidDto,
  LeagueEntryDto,
  MatchDto,
  SummonerDto,
  TimelineDto,
} from './types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RiotClientOptions {
  apiKey: string;
  platformUrl: string;
  regionUrl: string;
  limiter: RateLimiter;
  config: Pick<RiotClientConfig, 'requestTimeoutMs' | 'retry5xx' | 'retry429' | 'default429WaitSec' | 'rateLogIntervalMs'>;
  logger: Logger;
  fetch?: FetchLike;
  clock?: Clock;
}

export interface RiotStats {
  calls: number;
  ok: number;
  status429: number;
  retries: number;
  byStatus: Record<string, number>;
  lastAppRateCount: string | null;
}

export class RiotClient {
  readonly stats: RiotStats = { calls: 0, ok: 0, status429: 0, retries: 0, byStatus: {}, lastAppRateCount: null };
  private readonly fetchFn: FetchLike;
  private readonly clock: Clock;
  private lastRateLog = 0;

  constructor(private readonly opts: RiotClientOptions) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.clock = opts.clock ?? realClock;
  }

  /** 제한기 때문에 기다린 총 시간 (ms) */
  get limiterWaitedMs(): number {
    return this.opts.limiter.waitedMs;
  }

  getLeagueEntries(tier: string, division: string, page = 1): Promise<LeagueEntryDto[]> {
    return this.get(this.opts.platformUrl, `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`);
  }

  /**
   * startTime은 **초** (Riot match-v5 규칙). ms(13자리)를 잘못 넣는 실수를 막으려고
   * 10자리 정수가 아니면 호출 전에 던진다 (코드 오류, 재시도 대상 아님).
   */
  getMatchIds(puuid: string, q: { queue: number; start: number; count: number; startTime: number }): Promise<string[]> {
    if (!Number.isInteger(q.startTime) || q.startTime < 1_000_000_000 || q.startTime > 9_999_999_999) {
      return Promise.reject(new TypeError(`startTime은 10자리 초 정수여야 합니다: ${q.startTime}`));
    }
    return this.get(
      this.opts.regionUrl,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=${q.queue}&start=${q.start}&count=${q.count}&startTime=${q.startTime}`,
    );
  }

  getMatch(matchId: string): Promise<MatchDto> {
    return this.get(this.opts.regionUrl, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
  }

  getTimeline(matchId: string): Promise<TimelineDto> {
    return this.get(this.opts.regionUrl, `/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`);
  }

  // 아래 4개는 전적 검색(소환사 상세, back_spec 변경 03 W-2)용. collector/*는 이 메서드들을 쓰지 않는다.

  /** account-v1. 지역 라우팅(RIOT_REGION_URL). 실제 Riot 경로는 "riot/account/v1/…" (account-v1은 account 서비스 전용 하위 경로) */
  getAccountByRiotId(gameName: string, tagLine: string): Promise<AccountDto> {
    return this.get(
      this.opts.regionUrl,
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    );
  }

  /** summoner-v4 by-puuid. 플랫폼 라우팅(RIOT_PLATFORM_URL) */
  getSummonerByPuuid(puuid: string): Promise<SummonerDto> {
    return this.get(this.opts.platformUrl, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`);
  }

  /** league-v4 entries by-puuid. 플랫폼 라우팅. 언랭크면 빈 배열 */
  getLeagueEntriesByPuuid(puuid: string): Promise<LeagueEntryByPuuidDto[]> {
    return this.get(this.opts.platformUrl, `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);
  }

  /** match-v5 ids by-puuid. 큐 필터 없음(전적은 모든 큐). 지역 라우팅. 수집기 전용 getMatchIds와 별도 */
  getRecentMatchIds(puuid: string, q: { start: number; count: number }): Promise<string[]> {
    return this.get(
      this.opts.regionUrl,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${q.start}&count=${q.count}`,
    );
  }

  /** 로그용 경로: puuid가 들어간 경로는 앞 8자만 */
  private logPath(path: string): string {
    return path.replace(/(by-puuid\/)([^/]{8})[^/]*/, '$1$2…');
  }

  private async get<T>(base: string, path: string): Promise<T> {
    const { retry5xx, retry429, default429WaitSec, requestTimeoutMs } = this.opts.config;
    let n429 = 0;
    let n5xx = 0;
    for (;;) {
      await this.opts.limiter.acquire();
      this.stats.calls++;
      let res: Response;
      try {
        res = await this.fetchFn(base + path, {
          headers: { 'X-Riot-Token': this.opts.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (err) {
        // 네트워크 오류·10초 시간 초과: 일시 오류로 재시도
        this.count('network');
        if (n5xx >= retry5xx) {
          throw new RiotRetryExhaustedError(`네트워크 오류 재시도 ${retry5xx}번 실패: ${(err as Error).name}`, null, this.logPath(path));
        }
        await this.backoff5xx(n5xx++, 'network', path);
        continue;
      }

      const status = res.status;
      this.count(String(status));
      this.opts.limiter.syncFromHeaders(res.headers.get('x-app-rate-limit-count'), res.headers.get('x-app-rate-limit'));
      this.observe(res);

      if (status === 200) {
        this.stats.ok++;
        return (await res.json()) as T;
      }
      // 본문은 읽어 연결을 돌려준다 (내용은 쓰지 않음)
      await res.arrayBuffer().catch(() => undefined);

      if (status === 401 || status === 403) {
        throw new RiotKeyExpiredError(`Riot 키가 만료됐거나 잘못됐습니다 (HTTP ${status})`, status, this.logPath(path));
      }
      if (status === 404) throw new RiotNotFoundError('없음 (HTTP 404)', status, this.logPath(path));
      if (status === 429) {
        this.stats.status429++;
        if (n429 >= retry429) {
          throw new RiotRetryExhaustedError(`429 재시도 ${retry429}번 실패`, status, this.logPath(path));
        }
        n429++;
        const ra = Number(res.headers.get('retry-after'));
        const waitSec = Number.isFinite(ra) && ra > 0 ? ra : default429WaitSec;
        this.opts.logger.warn('Riot 429, Retry-After 만큼 대기 후 재시도', {
          waitSec,
          attempt: n429,
          type: res.headers.get('x-rate-limit-type'),
          path: this.logPath(path),
        });
        this.opts.limiter.block(waitSec * 1000);
        this.stats.retries++;
        continue;
      }
      if (status >= 500 && status <= 599) {
        if (n5xx >= retry5xx) {
          throw new RiotRetryExhaustedError(`HTTP ${status} 재시도 ${retry5xx}번 실패`, status, this.logPath(path));
        }
        await this.backoff5xx(n5xx++, String(status), path);
        continue;
      }
      // 400 등: 재시도해도 소용없음 (코드 버그 가능성)
      throw new RiotBadRequestError(`잘못된 요청 (HTTP ${status})`, status, this.logPath(path));
    }
  }

  private async backoff5xx(attempt: number, reason: string, path: string): Promise<void> {
    const ms = 1000 * 2 ** attempt; // 1초 → 2초 → 4초
    this.stats.retries++;
    this.opts.logger.warn('Riot 일시 오류, 재시도', { reason, waitMs: ms, attempt: attempt + 1, path: this.logPath(path) });
    await this.clock.sleep(ms);
  }

  private count(key: string): void {
    this.stats.byStatus[key] = (this.stats.byStatus[key] ?? 0) + 1;
  }

  /** X-App-Rate-Limit-Count를 기억하고 10분마다 로그에 남긴다 */
  private observe(res: Response): void {
    const c = res.headers.get('x-app-rate-limit-count');
    if (c) this.stats.lastAppRateCount = c;
    const now = this.clock.now();
    if (now - this.lastRateLog >= this.opts.config.rateLogIntervalMs) {
      this.lastRateLog = now;
      this.opts.logger.info('Riot 사용량', {
        appCount: c,
        appLimit: res.headers.get('x-app-rate-limit'),
        methodCount: res.headers.get('x-method-rate-limit-count'),
        calls: this.stats.calls,
      });
    }
  }
}
