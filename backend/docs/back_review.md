# 백엔드 검토 기록 — 변경 02 (L1~L5, 계약 문구, 프리셋 250) 검토

> 검토일: 2026-10-17 (KST)
> 기준: `CLAUDE.md` 9장 백엔드 Review, `backend/docs/back_spec.md`(승인됨, 변경 02 10-5·12장 V1~V8), `docs/contracts/api_contract.md` v2(문구 정정), `docs/contracts/db_contract.md`·`.dbml` v8
> 방법: Build 기록을 믿지 않고 코드를 직접 읽고, 검사·테스트를 다시 돌리고, 실제 Supabase(읽기 전용)로 표본 인원을 확인했다. 사용자가 2026-10-16 02-9 표의 결정 8건(V1~V8)을 모두 추천안대로 승인한 상태에서 구현이 그대로 됐는지 본다.
> 이 문서는 **가장 최근 검토만** 둔다. 해결되지 않은 문제는 `back_overview.md` "해결되지 않은 점"에 있다.
> 상태 표기: ✅ 통과 / ⚠️ 문제 있음 / ❌ 실패 / ⏸️ 확인 못 함

## 목차

- [1. 결론](#1-결론)
- [2. 검사·테스트 재실행](#2-검사테스트-재실행)
- [3. 완료 기준 10-5 확인](#3-완료-기준-10-5-확인)
- [4. 코드 품질 메모](#4-코드-품질-메모)
- [5. 범위 확인](#5-범위-확인)
- [6. Review가 고친 것](#6-review가-고친-것)
- [7. 남은 문제](#7-남은-문제)

---

## 1. 결론

> 요약: **PASS.** 승인된 8개 결정(V1~V8)이 모두 코드·테스트·문서에 반영됐고, 완료 기준 10-5를 전부 충족한다. 버그는 찾지 못했다. 설계를 바꿔야 하는 결함도 없다.

| 구분 | 결과 |
|------|------|
| 판정 | **PASS** |
| High | 0 |
| Medium | 0 |
| Low | 1 (L5 적용 범위가 `withTransaction`·`readSnapshot`로 한정돼, `aggregate` 시험용 명령의 직접 `pool.connect()`에는 리스너가 없음 — 계획에서 명시적으로 그렇게 범위를 정했으므로 결함이 아니라 참고 사항) |
| 고친 코드 | 없음 (작게 고칠 것도 발견하지 못함) |
| DB에 남긴 변화 | 없음 (읽기 전용 조회만) |

---

## 2. 검사·테스트 재실행

| 명령 | 결과 |
|------|------|
| `npm run typecheck` | 오류 0 |
| `npm run lint` | 오류 0 |
| `npm audit` | 취약점 0 |
| `npm test` | **92개** 통과 / 실패 0 |
| `npm run test:integration` | **17개** 통과 / 실패 0 (약 8.4초). 모두 ROLLBACK, 끝난 뒤 테스트 데이터 0줄 |

- Build 보고의 수치(92·17)와 그대로 일치한다.

---

## 3. 완료 기준 10-5 확인

| # | 항목 | 확인 방법 | 결과 |
|---|------|-----------|------|
| 02-2 | 표본 보충은 모자란 만큼만, `--resample`은 전체 재샘플 | `sample.ts` 코드: `divisionQuota(opts.resample ? cfg.playersPerTier : Math.max(0, cfg.playersPerTier - have))`. `sample.test.ts` 4개(have=180→70명만, have=0→250명 전체, 충분하면 건너뜀, `--resample`이면 250명 전체를 다시) | ✅ |
| 02-3 | 중단·실패 종료의 `stoppedBy`가 `aborted`/`failed` | `matches.ts`에 타입 추가, `collect.ts` catch에서 `if (m && m.stoppedBy === 'done') m.stoppedBy = err instanceof UserAbortError ? 'aborted' : 'failed'`. `collection_logs.status`(원래부터 정확)는 그대로 둠 | ✅ |
| 02-4 | ② 게임 ID에도 연속 20개 실패 상한 | `matches.ts`에 `idsConsecutiveFailures` 카운터, 성공 시 리셋, `riotCfg.maxConsecutiveMatchFailures`(③~⑤와 같은 상수) 도달 시 `TooManyFailuresError`. `matches.test.ts` 2개: 연속 20개에서 멈춤(정확히 20번만 호출), 10번째 성공 시 리셋돼 30번째에서 멈춤 — 둘 다 실제로 함수를 돌려 호출 횟수로 검증 | ✅ |
| 02-5 | `/health` DB 오류가 서버 로그에 남음(응답은 그대로) | `meta.ts`: `catch (err) { logger.error('health DB 확인 실패', { error: formatError(err) }); throw new ApiError(503, 'DB_UNAVAILABLE', …); }`. 응답 바디·코드는 안 바뀜. `app.test.ts` 신규 테스트: 503 + `DB_UNAVAILABLE` 확인과 동시에 `logger.errors`에 1건, 메시지에 `ECONNREFUSED` 포함 확인 | ✅ |
| 02-6 | `withTransaction`·`readSnapshot`에 `logger` 선택 매개변수로 연결 오류 리스너 | `tx.ts`·`snapshot.ts`: `logger?: Logger` 추가, 넘기면 `client.on('error', …)`로 로그만. `db.test.ts` 4개: 로그 남음/안 남김(리스너 미부착) 양쪽 다 확인. `server.ts`가 `readSnapshot(pool, fn, logger)`로 실제 연결, `matches.ts`의 ⑤ 저장이 `withTransaction(pool, fn, logger)`로 실제 연결 | ✅ |
| 02-7 | `config/collection.ts`의 `test.playersPerTier === 250` | 코드에서 확인, `db_contract.md` v8(변경 04)의 "티어당 250명"과 일치. `rules.test.ts`가 `c.playersPerTier === 250`과 `divisionQuota(250) = {63,63,62,62}` 확인 | ✅ |
| 02-8 | `api_contract.md` 2-4 문구·6장 날짜 순서 | 2-4: "프론트는 핵심 아이템 3개와 신발을 따로 골라 보여준다(계산 방식은 프론트 범위). 백엔드는 지금처럼 전체 아이템을 pick 순으로 준다" — 3-1 참조 결과 프론트 실제 동작과 일치. 6장: 2026-10-14(v2 초안) → 2026-10-15(구현 반영, 날짜 오타 고침) → 2026-10-16(문구 정정)으로 순서가 맞게 됐다 | ✅ |
| 02-1 | 15명 400은 조치 없음, 조사 완료로 닫음 | `back_overview.md` 10장·`back_spec.md` 12장 V1에 "이전 만료 키 시기에 뽑히고 재확인 안 된 표본, 영향 0.17%" 기록. DB에 삭제·수정 없음(아래 3-1 확인) | ✅ |

### 3-1. L1 실제 DB 확인 (읽기 전용)

`ranked_players`를 티어별로 `count(*)`한 결과:

| 티어 | 인원 |
|------|------|
| PLATINUM | 250 |
| EMERALD | **265** |
| DIAMOND | 250 |

- 에메랄드 265명은 **변경 01 당시(이전 버그로 전체 재추가)의 기존 데이터**이고, 이번 Review는 DB에 쓰기를 하지 않았으므로 숫자가 바뀌지 않는다. `back_overview.md`도 이미 "에메랄드가 265명이 됐다"를 과거 사실로 적어 두고 있어 문서와 실제가 일치한다.
- L1 수정은 **다음 실행부터** 적용된다: `sample.test.ts`로 have=180/playersPerTier=250이면 70명만 더함을 확인했고, 실제로 `run`을 다시 돌리면 에메랄드는 265 → (250 이상이라 건너뜀, upserted 0)가 될 것이다. `--resample`을 주면 250명 전체를 다시 뽑아 더해 265+250 = 515명이 된다(결정 02-2, V2와 일치하는 예상 동작).
- 15명 400 플레이어도 그대로 있다(조치 없음, V1과 일치). `DELETE` 등 쓰기 SQL은 실행하지 않았다.

### 3-2. 가짜 pool stub `.on` 추가의 실제 pg 적합성

Build 보고에 있던 "가짜 pool stub에 `.on` 추가"를 실제 `pg` 동작과 대조했다.

- 실제 `pg.Pool.connect()`는 콜백/프라미스로 **`pg.PoolClient`**(= 실제 백엔드 연결을 감싼 `Client`에 `release` 메서드를 추가한 객체)를 돌려준다. `PoolClient`는 Node `EventEmitter`를 상속하는 `Client`를 확장하므로 `.on('error', …)`는 실제 pg 타입에 존재하는 정상 API다 (pg 공식 문서: "클라이언트가 예기치 않게 연결을 잃으면 풀이 아니라 **클라이언트 인스턴스**가 `'error'`를 낸다").
- `tx.ts`/`snapshot.ts`에서 쓰는 `client.on('error', …)`는 바로 이 공식 패턴과 같다. 테스트의 가짜 `fakeClient()`(`db.test.ts`)도 `EventEmitter`를 `Object.assign`해 같은 인터페이스를 흉내 냈고, `matches.test.ts`/`sample.test.ts`의 가짜 pool도 `connect: async () => ({ query, release, on: () => undefined })`로 실제 호출 시그니처(세 메서드)를 그대로 맞췄다.
- 결론: 가짜 stub이 실제 운영 `pg.Pool`의 동작과 다르게 치우쳐 테스트를 통과시키는 문제는 없다.

---

## 4. 코드 품질 메모

수정된 모든 파일(`sample.ts`, `matches.ts`, `collect.ts`, `meta.ts`, `tx.ts`, `snapshot.ts`, `server.ts`, `collection.ts`, 신규/수정 테스트, 문서)을 리뷰어 관점에서 읽었다.

- **버그·회귀 없음.** ②의 연속 실패 상한이 ③~⑤와 같은 `riotCfg.maxConsecutiveMatchFailures`를 재사용하는 점(V4)도 코드로 확인했고, 설정값이 늘지 않아 유지보수 부담이 적다.
- **네이밍**: `idsConsecutiveFailures`(②)와 `consecutiveFailures`(③~⑤)가 스코프가 분리된 지역 변수라 혼동 위험이 작다. 굳이 통합할 필요는 없다(②는 ③~⑤ 루프 시작 전에 끝나는 별도 단계).
- **중복**: `withTransaction`과 `readSnapshot`의 로거-리스너 부착 코드가 2곳에서 거의 같은 모양으로 반복된다(`if (logger) { client.on('error', …) }`). 작은 중복이라 공용 헬퍼로 뽑을 만큼의 가치는 크지 않다고 판단해 손대지 않았다(설계 변경에 해당해 Review 범위를 넘어선다고 보고 보고만 함).
- **`meta.ts`**: `catch` 블록이 `err`를 받아 로그만 남기고 그대로 `ApiError`로 바꾸는 흐름이 명확하다. `formatError`가 기존에 쓰던 가리기 함수를 그대로 재사용해 비밀값 노출 위험이 없다.
- **테스트**: `matches.test.ts`의 리셋 테스트("10번째만 성공 → n=30에서 멈춤")는 숫자를 하드코딩하지 않고 실제 함수 동작으로 값을 검증해, 카운터 리셋 로직이 실제로 동작함을 의미 있게 보장한다. `sample.test.ts`/`db.test.ts`도 마찬가지로 실제 모듈을 호출해 결과를 비교한다(목표 동작을 가정해 끼워 맞추지 않음).
- **문서**: `back_build.md`·`back_spec.md`·`api_contract.md`의 수치·날짜가 코드·테스트 결과와 모두 일치했다(92개 단위 테스트, divisionQuota(250)=63/63/62/62, 날짜 순서).

---

## 5. 범위 확인

| 확인 | 결과 |
|------|------|
| `docs/contracts/db_contract.md`, `.dbml` 수정 여부 | 수정 없음 (`git diff --stat`에 없음) |
| `db/` 수정 여부 | 수정 없음 |
| `frontend/` 수정 여부 | 수정 없음 |
| `.env`, `.env.example` | `.env.example` 변경 없음 (새 환경 변수 없음과 일치) |
| 비밀값 노출 | `grep`으로 `RIOT_API_KEY=`·`DATABASE_URL=postgres` 실제 값 패턴 검색, 변경된 문서·로그에 값 없음 (테스트 환경 변수 예시 `RIOT_API_KEY=invalid`는 기존 문서에 이미 있던 것으로 비밀값이 아님) |

---

## 6. Review가 고친 것

- 없음. 설계를 바꿔야 하는 결함을 찾지 못했고, 오타·테스트 보강이 필요한 곳도 보이지 않았다.

---

## 7. 남은 문제

- L5(연결 오류 리스너)는 계획대로 `withTransaction`·`readSnapshot`에만 적용됐다. `collector/aggregate.ts`의 `aggregateWindowOnPool`은 여전히 `pool.connect()`에 리스너가 없다 — 다만 이 명령은 사람이 직접 실행하는 시험용이라(자동 집계는 DB 예약 작업이 SQL로 직접 함) 위험이 작고, 계획에서 범위를 명시적으로 좁혔으므로 이번 변경의 결함은 아니다. 다음에 연결 안전성을 더 다루게 되면 참고할 항목으로만 남긴다.
- 그 밖의 남은 점은 `back_overview.md` 10장(해결되지 않은 점)에 갱신해 두었다.
