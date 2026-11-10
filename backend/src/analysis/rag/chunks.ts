// RAG 지식 문서 → 조각 (ai_spec B4-2·B4-3, F-1·F-2). 파일 읽기 말고는 순수 함수다.
// 조각 하나 = `### <id> <제목>` + `- meta: k=v, ...` 한 줄 + 본문 2~5문장. 고정 길이로 자르지 않는다.
// 허용 값은 엔진과 같은 목록(유형 10개 + ALL, 과목 ID = labels.ts SUBJECT_LABEL)과 계약 v9 12-1의 CHECK 값이다.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORBIDDEN_PATTERNS, INTERPRETIVE_WORDS, SUBJECT_LABEL, VAGUE_PATTERNS } from '../llm/labels.js';
import type { Position, Role } from '../types.js';

export const ROLES: readonly Role[] = [
  'TOP_TANK',
  'TOP_DAMAGE',
  'JUNGLE_TANK',
  'JUNGLE_DAMAGE',
  'MID_TANK',
  'MID_DAMAGE',
  'ADC',
  'SUPPORT_TANK',
  'SUPPORT_DAMAGE',
  'SUPPORT_UTILITY',
];

/** 유형 → 포지션 (조각의 position 기본값) */
export const ROLE_POSITION: Readonly<Record<Role, Position>> = {
  TOP_TANK: 'TOP',
  TOP_DAMAGE: 'TOP',
  JUNGLE_TANK: 'JUNGLE',
  JUNGLE_DAMAGE: 'JUNGLE',
  MID_TANK: 'MIDDLE',
  MID_DAMAGE: 'MIDDLE',
  ADC: 'BOTTOM',
  SUPPORT_TANK: 'UTILITY',
  SUPPORT_DAMAGE: 'UTILITY',
  SUPPORT_UTILITY: 'UTILITY',
};

export type ChunkRole = Role | 'ALL';
export type ChunkPosition = Position | 'ALL';
export type ChunkArea = 'laning' | 'fight' | 'macro' | 'general';
export type ChunkPolarity = 'good' | 'bad' | 'any';

const POSITIONS: readonly ChunkPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'ALL'];
const AREAS: readonly ChunkArea[] = ['laning', 'fight', 'macro', 'general'];
const POLARITIES: readonly ChunkPolarity[] = ['good', 'bad', 'any'];
const META_KEYS = ['role', 'area', 'subject', 'polarity', 'position'] as const;

/** 본문 길이 경고 기준 (소제목+본문) */
export const CHUNK_MAX_CHARS = 600;
export const CHUNK_SENTENCES = { min: 2, max: 5 } as const;
/** 1차는 관점 조각만 (Data Dragon 챔피언 조각은 보류, B4-1) */
export const CHUNK_SOURCE = 'perspective' as const;

/** rag_chunk 한 행에 들어가는 값 (embedding·embedding_model·updated_at 제외) */
export interface KnowledgeChunk {
  id: string;
  source: typeof CHUNK_SOURCE;
  position: ChunkPosition;
  role: ChunkRole;
  area: ChunkArea;
  /** NULL = 과목 무관 (그 영역 공통) */
  subject: string | null;
  polarity: ChunkPolarity;
  title: string;
  body: string;
  /** 임베딩·저장하는 본문 = 소제목 + 줄바꿈 + 본문 */
  content: string;
  /** sha256(content), 소문자 hex 64자 (계약 CHECK) */
  contentHash: string;
  file: string;
  line: number;
}

export interface ChunkIssue {
  file: string;
  line: number;
  id: string | null;
  message: string;
}

export interface ParseResult {
  chunks: KnowledgeChunk[];
  errors: ChunkIssue[];
  warnings: ChunkIssue[];
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 숫자(아라비아·전각·기타 십진 숫자) 포함 여부. 조각에는 숫자를 쓰지 않는다 (경계는 rules.ts만) */
export const DIGIT_RE = /\p{Nd}/u;

function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/** 조각 ID 규칙: `<과목ID 또는 영역.common>.<유형>.<방향>.<두 자리>` (예: fight.damage.SUPPORT_DAMAGE.bad.01) */
export function expectedIdPrefix(c: Pick<KnowledgeChunk, 'area' | 'subject' | 'role' | 'polarity'>): string {
  return `${c.subject ?? `${c.area}.common`}.${c.role}.${c.polarity}.`;
}

/** ID에서 유형을 읽는다 (search_rag_chunks 결과에는 role 칸이 없어서 검색이 유형 조각을 먼저 고를 때 쓴다) */
export function roleOfId(id: string): ChunkRole | null {
  const parts = id.split('.');
  const r = parts[parts.length - 3];
  return r === 'ALL' || (ROLES as readonly string[]).includes(r ?? '') ? (r as ChunkRole) : null;
}

/** 문서 하나를 조각으로 나누고 검사한다 */
export function parseKnowledgeFile(text: string, file: string): ParseResult {
  const chunks: KnowledgeChunk[] = [];
  const errors: ChunkIssue[] = [];
  const warnings: ChunkIssue[] = [];
  const lines = text.split(/\r?\n/);
  type Raw = { id: string; title: string; line: number; meta: string | null; body: string[] };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  lines.forEach((ln, i) => {
    const h = /^###\s+(\S+)\s*(.*)$/.exec(ln);
    if (h) {
      cur = { id: h[1]!, title: h[2]!.trim(), line: i + 1, meta: null, body: [] };
      raws.push(cur);
      return;
    }
    if (!cur) return; // 첫 조각 앞의 제목·설명은 조각이 아니다
    const c: Raw = cur;
    if (/^#{1,3}\s/.test(ln)) {
      cur = null; // ### 아닌 다른 소제목이 나오면 조각이 끝난다
      return;
    }
    const m = /^-\s*meta:\s*(.*)$/.exec(ln);
    if (m && c.meta === null && c.body.length === 0) c.meta = m[1]!;
    else if (ln.trim().length > 0) c.body.push(ln.trim());
  });

  for (const r of raws) {
    const issue = (message: string): ChunkIssue => ({ file, line: r.line, id: r.id, message });
    const err = (message: string) => errors.push(issue(message));
    const warn = (message: string) => warnings.push(issue(message));
    if (!r.title) err('소제목에 제목이 없음 (`### <id> <제목>`)');
    if (r.meta === null) {
      err('`- meta:` 줄이 없음 (소제목 바로 아래)');
      continue;
    }
    const meta = new Map<string, string>();
    for (const part of r.meta.split(',').map((s) => s.trim()).filter(Boolean)) {
      const kv = /^([a-z]+)\s*=\s*(.+)$/.exec(part);
      if (!kv) {
        err(`meta 형식 오류: "${part}" (k=v)`);
        continue;
      }
      if (!(META_KEYS as readonly string[]).includes(kv[1]!)) err(`알 수 없는 meta 키: ${kv[1]}`);
      else if (meta.has(kv[1]!)) err(`meta 키 중복: ${kv[1]}`);
      meta.set(kv[1]!, kv[2]!.trim());
    }
    const role = meta.get('role');
    const area = meta.get('area');
    const subjectRaw = meta.get('subject');
    const polarity = meta.get('polarity');
    for (const k of ['role', 'area', 'polarity'] as const) if (!meta.has(k)) err(`필수 meta 누락: ${k}`);
    if (role && role !== 'ALL' && !(ROLES as readonly string[]).includes(role)) err(`허용되지 않은 role: ${role}`);
    if (area && !(AREAS as readonly string[]).includes(area)) err(`허용되지 않은 area: ${area}`);
    if (polarity && !(POLARITIES as readonly string[]).includes(polarity)) err(`허용되지 않은 polarity: ${polarity}`);
    const subject = subjectRaw === undefined || subjectRaw === 'none' ? null : subjectRaw;
    if (subject !== null) {
      if (!(subject in SUBJECT_LABEL)) err(`허용되지 않은 subject: ${subject} (엔진 과목 ID)`);
      else if (area && !subject.startsWith(`${area}.`)) err(`subject ${subject}가 area ${area}에 속하지 않음`);
    } else if (area && area !== 'general') {
      warn('subject 없음: 이 영역의 모든 과목에 검색된다');
    }
    if (area === 'general' && subject !== null) err('area=general에는 subject를 쓰지 않음');
    const validRole = role && (role === 'ALL' || (ROLES as readonly string[]).includes(role)) ? (role as ChunkRole) : null;
    const position = meta.get('position') ?? (validRole && validRole !== 'ALL' ? ROLE_POSITION[validRole] : 'ALL');
    if (!(POSITIONS as readonly string[]).includes(position)) err(`허용되지 않은 position: ${position}`);
    else if (validRole && validRole !== 'ALL' && position !== ROLE_POSITION[validRole] && position !== 'ALL') {
      err(`position ${position}가 role ${validRole}의 포지션(${ROLE_POSITION[validRole]})과 다름`);
    }

    const body = r.body.join(' ');
    const content = `${r.title}\n${body}`;
    if (body.length === 0) err('본문이 없음');
    if (DIGIT_RE.test(r.title) || DIGIT_RE.test(body)) err('숫자 포함: 조각에는 숫자를 쓰지 않는다 (경계값은 rules.ts만, LLM이 섞어 쓸 수 있음)');
    if (content.length > CHUNK_MAX_CHARS) warn(`${content.length}자 (권장 ${CHUNK_MAX_CHARS}자 이하)`);
    const sc = sentenceCount(body);
    if (body.length > 0 && (sc < CHUNK_SENTENCES.min || sc > CHUNK_SENTENCES.max)) warn(`${sc}문장 (권장 ${CHUNK_SENTENCES.min}~${CHUNK_SENTENCES.max}문장)`);
    const interp = INTERPRETIVE_WORDS.filter((w) => content.includes(w));
    if (interp.length > 0) warn(`해석어 ${interp.map((w) => `"${w}"`).join(', ')}: LLM 문장 검증기가 "~것으로 보입니다" 없이 막는 말`);
    // Q2: 은어("낀")·막연한 조언("~볼 수 있다", "이어 가")은 조각에서도 오류. 조각은 "조건 + 구체 행동" 꼴로 쓴다
    for (const { re, why } of VAGUE_PATTERNS) if (re.test(content)) err(`${why}: 조각은 "조건 + 구체 행동"으로 쓴다`);
    for (const { re, why } of FORBIDDEN_PATTERNS) if (!VAGUE_PATTERNS.some((v) => v.re === re) && re.test(content)) warn(`금지 표현(${why}): LLM 문장에서 막히는 말`);

    if (validRole && area && polarity && (POLARITIES as readonly string[]).includes(polarity)) {
      const prefix = expectedIdPrefix({ area: area as ChunkArea, subject, role: validRole, polarity: polarity as ChunkPolarity });
      if (!r.id.startsWith(prefix) || !/^\d{2}$/.test(r.id.slice(prefix.length))) err(`ID가 규칙과 다름: 기대 "${prefix}NN"`);
    }
    if (errors.some((e) => e.line === r.line && e.file === file)) continue;
    chunks.push({
      id: r.id,
      source: CHUNK_SOURCE,
      position: position as ChunkPosition,
      role: validRole!,
      area: area as ChunkArea,
      subject,
      polarity: polarity as ChunkPolarity,
      title: r.title,
      body,
      content,
      contentHash: sha256Hex(content),
      file,
      line: r.line,
    });
  }
  return { chunks, errors, warnings };
}

/** 여러 문서 → 조각 전체. ID 중복도 여기서 본다 */
export function parseKnowledgeFiles(files: readonly { name: string; text: string }[]): ParseResult {
  const out: ParseResult = { chunks: [], errors: [], warnings: [] };
  const seen = new Map<string, string>();
  for (const f of files) {
    const r = parseKnowledgeFile(f.text, f.name);
    out.errors.push(...r.errors);
    out.warnings.push(...r.warnings);
    for (const c of r.chunks) {
      const prev = seen.get(c.id);
      if (prev) {
        out.errors.push({ file: c.file, line: c.line, id: c.id, message: `ID 중복 (${prev}에도 있음)` });
        continue;
      }
      seen.set(c.id, `${c.file}:${c.line}`);
      out.chunks.push(c);
    }
  }
  out.chunks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** 폴더의 *.md(README.md 제외)를 이름 순으로 읽는다 */
export function readKnowledgeDir(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

export function loadKnowledgeDir(dir: string): ParseResult {
  return parseKnowledgeFiles(readKnowledgeDir(dir));
}

/** knowledgeVersion에 들어가는 조각 한 줄 (DB 행으로도 같은 값을 만들 수 있게 칸만 쓴다) */
export interface VersionRow {
  id: string;
  source: string;
  position: string;
  role: string;
  area: string;
  subject: string | null;
  polarity: string;
  contentHash: string;
}

/** 조각 전체 해시 앞 12자. 조각 하나라도 본문·메타가 바뀌면 바뀌어 API 캐시 키가 바뀐다 */
export function knowledgeVersion(rows: readonly VersionRow[]): string {
  const lines = [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => [r.id, r.source, r.position, r.role, r.area, r.subject ?? '', r.polarity, r.contentHash].join('|'));
  return sha256Hex(lines.join('\n')).slice(0, 12);
}
