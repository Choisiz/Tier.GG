# Tier.GG

> **현재 버전: v0.5.2** (2026-11-04) · 개발 중 (미완성)

리그 오브 레전드(KR) 전적·통계 사이트입니다. 챔피언 티어리스트와 추천 빌드, 소환사 전적 검색을 제공하고, **LLM과 RAG로 한 판을 분석해 피드백을 주는 AI 기능**을 만들고 있습니다.

참고 사이트: [op.gg](https://op.gg), [lol.ps](https://lol.ps) (흐름과 구성만 참고하고 디자인·코드는 따라 하지 않습니다)

## 목차

1. 주요 기능
2. 전체 구성
3. 기술 스택
4. 로컬 실행
5. 프로젝트 구조와 문서
6. 버전 기록
7. 버전 규칙
8. 앞으로 할 일

---

## 1. 주요 기능

| 기능 | 내용 | 상태 |
|------|------|------|
| 챔피언 티어리스트 | 포지션별 티어, 승률·픽률·밴률 (최근 14일, 플래티넘~다이아 표본) | ✅ |
| 챔피언 상세 | 추천 룬·아이템·소환사 주문·스킬 순서, 스킬 설명, 스킨 | ✅ |
| 전적 검색 | 프로필(티어·레벨·갱신하기), 솔로·자유랭크 카드, 최근 20판 요약, 매치 목록(킬관여·라인전 15분 골드) | ✅ |
| 매치 상세 기록 | 매치를 펼치면 두 팀 10명 상세 표(KDA·킬관여·딜·골드·CS·시야·아이템·룬), 팀 오브젝트·밴, 닉네임 눌러 이동 | ✅ |
| **AI 게임 분석** | 매치를 펼쳐 "AI 분석하기" → 라인전·교전·운영별 좋은 점/부족한 점, 결정적 장면, 요약 | ✅ (RAG 전) |
| RAG 지식 검색 | 포지션·유형별 해석 문서를 검색해 피드백 근거로 사용 | 🔜 |
| 롤 재판 | 같은 판의 두 플레이어를 1:1로 비교 | 🔜 |

### AI 게임 분석의 원칙

**판단은 코드가, 설명은 LLM이** 합니다. LLM이 숫자를 지어내거나 판정을 바꿀 수 없게 했습니다.

```
Riot match + timeline
  → ① 판정 엔진(코드): 지표 계산, 과목별 A~E 등급, 반영 비율, 결정적 장면
  → ② (예정) RAG: 이 판 상황에 맞는 해석 문서 검색
  → ③ LLM(Claude): ①·②만 근거로 문장 작성 (정해진 JSON 형식)
  → ④ 검증기(코드): 숫자·방향·금지어 검사 → 1회 재시도 → 실패한 문장만 기본 문장으로
```

- 등급 기준은 실제 200판(플레이어 2,000명) 분포로 정했습니다.
- RAG 없이 만든 결과(기준선)와 RAG를 붙인 결과를 같은 판으로 비교해 효과를 수치로 확인합니다.
- 자세한 설명: [docs/ai/README.md](docs/ai/README.md)

## 2. 전체 구성

```
Riot API ──▶ 수집기 (backend CLI, 직접 실행)
                │  게임 저장
                ▼
           Supabase PostgreSQL ── 매일 05:00 KST 집계 (최근 14일)
                │
                ▼
           읽기 API (backend, Express) ◀── Riot API (전적 검색·분석은 실시간 호출)
                │                      ◀── Claude API (AI 분석)
                ▼
           Next.js 화면 (frontend) ◀── Data Dragon (이름·이미지)
```

## 3. 기술 스택

| 영역 | 스택 |
|------|------|
| 프론트엔드 | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| 백엔드 | Node.js, Express, TypeScript |
| DB | Supabase (PostgreSQL 17, pg_cron) |
| AI | Claude API (`claude-opus-5-5`, 구조화 출력), 예정: 임베딩 + Supabase pgvector |
| 외부 데이터 | Riot API (match-v5, league-v4, account-v1), Data Dragon |

## 4. 로컬 실행

1. 저장소 루트에 `.env`를 만듭니다. 변수 목록과 설명은 [.env.example](.env.example)에 있습니다.
2. 백엔드 API를 실행합니다.
   ```bash
   cd backend && npm install && npm run dev
   ```
3. 프론트를 실행하고 http://localhost:3000 을 엽니다.
   ```bash
   cd frontend && npm install && npm run dev
   ```

**AI 분석을 쓰려면** `.env`에 아래를 넣고 백엔드를 다시 켭니다. 실수로 유료 호출이 나가지 않도록 기본은 꺼져 있습니다.

```
ANTHROPIC_API_KEY=...
FEEDBACK_ENABLED=true
FEEDBACK_LLM_ENABLED=true        # false면 돈이 들지 않는 기본 문장만
FEEDBACK_API_BUDGET_USD=0.50     # 누적 비용 상한
```

**데이터 수집**: Riot 개발용 키는 24시간마다 만료되므로, 새 키를 `.env`에 넣고 직접 실행합니다.

```bash
cd backend && npm run collect -- run --preset test --players-per-tier 250
```

## 5. 프로젝트 구조와 문서

```
backend/     수집기, 읽기 API, AI 판정 엔진·LLM (src/analysis)
frontend/    Next.js 화면
db/          마이그레이션 SQL
docs/        계약 문서(contracts/), AI 설계(ai/)
CLAUDE.md    작업 규칙 (AI 에이전트와 함께 개발하는 흐름)
```

| 영역 | 현재 상태 (먼저 읽기) | 계획 / 구현 / 검토 |
|------|----------------------|--------------------|
| DB | [db_overview](db/docs/db_overview.md) | [spec](db/docs/db_spec.md) / [build](db/docs/db_build.md) / [review](db/docs/db_review.md) |
| 백엔드 | [back_overview](backend/docs/back_overview.md) | [spec](backend/docs/back_spec.md) / [build](backend/docs/back_build.md) / [review](backend/docs/back_review.md) |
| 프론트 | [front_overview](frontend/docs/front_overview.md) | [spec](frontend/docs/front_spec.md) / [build](frontend/docs/front_build.md) / [review](frontend/docs/front_review.md) |
| AI | [docs/ai/README.md](docs/ai/README.md) (사람용 요약) | [spec](docs/ai/ai_spec.md) / [build](docs/ai/ai_build.md) / [review](docs/ai/ai_review.md) |

계약 문서(영역 사이의 약속): [db_contract.md](docs/contracts/db_contract.md) (DB ↔ 백엔드), [api_contract.md](docs/contracts/api_contract.md) (백엔드 ↔ 프론트)

### 개발 방식

AI 에이전트(Claude Code)와 함께 **Plan → 사용자 승인 → Build → (필요 시) Review** 흐름으로 개발합니다. 영역끼리는 계약 문서로만 소통하고, 계획·구현·검토 기록을 문서로 남깁니다. 규칙은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 6. 버전 기록

새 버전이 위에 옵니다. 큰 변경은 아래 "주요 변경"에 따로 적습니다.

| 버전 | 날짜 | 내용 | 커밋 |
|------|------|------|------|
| v0.5.2 | 2026-11-04 | Riot 개인 키 전환, 옛 데이터 삭제 후 전체 재수집(표본 1,500명, 6,800판, 10/20~11/03) 기록 | (이번) |
| v0.5.1 | 2026-11-04 | 커밋 작성자 이메일을 GitHub 계정으로 정정(10/12 이후 48개 커밋 재작성), 문서의 커밋 해시 갱신 | `39a8629` |
| **v0.5.0** | 2026-11-03 | **매치 상세 기록**: 펼친 매치에 "상세 기록 · AI 분석" 탭, 두 팀 10명 상세 표(KDA·딜·골드·CS·시야·아이템·룬)와 팀 요약(오브젝트·밴) | `3f8cbe5` |
| v0.4.1 | 2026-11-03 | GitHub README 작성, 버전 기록·규칙 도입 | `fe13788` |
| **v0.4.0** | 2026-11-03 | **AI 게임 분석**: 판정 엔진, Claude 문장 생성·숫자 검증, 분석 API, 매치 펼침 화면 | `42f1981` |
| v0.3.0 | 2026-10-30 | 전적 검색 요약 카드, 킬관여, 라인전 15분 골드, 자유랭크 카드, 프로필 헤더(갱신하기) | `4b87c48` |
| v0.2.0 | 2026-10-27 | 전적 검색 API·화면, 매치 행(아이템·룬·참가자 딜량), 티어 엠블럼 | `1690173` |
| v0.1.0 | 2026-10-17 | DB 스키마·매일 집계, Riot 수집기·읽기 API, 챔피언 티어리스트·상세 페이지 | `f13595b` |
| v0.0.x | 2025 | 초기 시도 (Airflow 인프라, 챔피언 목록·상세 UI 시제품) | `6836c41`~`0234719` |

### 주요 변경

**v0.5.0 · 매치 상세 기록 (2026-11-03)**
- 전적 검색 응답(계약 2-5)에 참가자 상세 19개 항목과 팀 요약 추가. Riot 추가 호출 없음
- 펼친 매치에 탭(상세 기록 / AI 분석), 본인 줄 강조, 1280px 한 줄 표 · 360px 접힌 줄(가로 스크롤 없음)

**v0.4.0 · AI 게임 분석 (2026-11-01 ~ 11-03)**
- 피드백 설계: 라인전(상대 라이너 대비)·교전(오브젝트 앞뒤 40초)·운영(그 밖), 유형 10개(탱/딜 × 포지션, 유틸 서폿), 과목별 반영 비율, A~E 등급을 실제 200판 분포로 설정
- 판정 엔진(`backend/src/analysis`): LLM·DB 없이 한 판을 계산, 테스트 82개
- LLM 단계: Claude Opus 5.5, 구조화 출력, 검증기, 비용 장부·예산 가드, 녹화 재생(0원 반복). 기준선 5판 54문장 1차 통과 94.4%, 최종 오류 0
- 분석 API `POST /api/v1/matches/:matchId/feedback` (계약 v4): 스위치 기본 꺼짐, 하루 20회, 예산 예약, 메모리 캐시
- 화면: 매치 행 펼침 안 "AI 분석하기"

**v0.2.0 · 전적 검색 (2026-10-27)**
- Riot API 실시간 조회(저장 없음, 60초 캐시), API 전용 호출 한도
- op.gg 흐름을 참고한 매치 행 레이아웃을 사용자 피드백으로 여러 번 다듬음

**v0.1.0 · 통계 사이트 기반 (2026-10-14 ~ 10-17)**
- Supabase 스키마(원본 21일 보관, 14일 창 집계, pg_cron 매일 집계)
- 표본 765명·약 4천 판 수집, 포지션별 티어리스트·추천 빌드 API와 화면

## 7. 버전 규칙

`v0.MINOR.PATCH` 형식을 씁니다. 정식 공개 전까지 앞자리는 0입니다.

| 올리는 자리 | 언제 | 예 |
|-------------|------|-----|
| MINOR | 새 기능, 화면·API가 눈에 띄게 바뀌는 변경 | 전적 검색 추가, AI 분석 추가 |
| PATCH | 버그 수정, 작은 UI 조정, 문서 | 조사 수정, README 갱신 |

- **푸시할 때마다** 버전을 올리고 위 "버전 기록" 표에 한 줄을 추가합니다.
- 큰 변경(MINOR)은 "주요 변경"에도 짧게 적습니다.
- 맨 위 "현재 버전"도 함께 바꿉니다.

## 8. 앞으로 할 일

- [ ] RAG: 벡터 DB(pgvector), 포지션·유형별 해석 문서 작성·검색, 기준선과 비교
- [ ] AI 문장 품질: 역전 장면 표현, 숫자 단위 검증
- [x] 매치 상세 지표 (v0.5.0)
- [ ] 매치 빌드 탭 (아이템 구매·스킬 순서, 타임라인 필요)
- [ ] 롤 재판 (같은 판 1:1 비교)
- [ ] Next.js 보안 업데이트
