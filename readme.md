# Tier.GG

리그 오브 레전드(KR 솔로랭크) 챔피언 통계 사이트입니다. 포지션별 티어리스트와 챔피언별 추천 빌드(아이템, 룬, 소환사 주문, 스킬 순서)를 보여줍니다.

> 이 문서는 전체 구성과 안내만 다룹니다. 영역별 자세한 현재 상태는 아래 "영역별 문서"를 봅니다.

## 전체 구성

```
Riot API ──▶ 수집기 (backend CLI, 직접 실행)
                │  게임 저장
                ▼
           Supabase PostgreSQL (db)
                │  매일 05:00 KST pg_cron 집계 (최근 14일)
                ▼
           집계 스냅숏 + 티어 뷰
                │  읽기 전용
                ▼
           읽기 API (backend, Express) ──▶ Next.js 화면 (frontend) ◀── Data Dragon (이름·이미지)
```

| 영역 | 하는 일 | 스택 |
|------|---------|------|
| DB | 원본 게임 저장, 최근 14일 집계, 티어 계산, 매일 자동 집계 | Supabase (PostgreSQL 17, pg_cron) |
| 백엔드 | Riot API 수집기, 읽기 API | Node.js, Express, TypeScript |
| 프론트 | 포지션별 티어리스트, 챔피언 상세, 추천 빌드 | Next.js 16, React 19, Tailwind 4 |

## 영역별 문서

| 영역 | 현재 상태 (먼저 읽기) | 과정 기록 (계획 / 구현 / 검토) |
|------|----------------------|-------------------------------|
| DB | [db/docs/db_overview.md](db/docs/db_overview.md) | [db_spec](db/docs/db_spec.md) / [db_build](db/docs/db_build.md) / [db_review](db/docs/db_review.md) |
| 백엔드 | [backend/docs/back_overview.md](backend/docs/back_overview.md) | [back_spec](backend/docs/back_spec.md) / [back_build](backend/docs/back_build.md) / [back_review](backend/docs/back_review.md) |
| 프론트 | [frontend/docs/front_overview.md](frontend/docs/front_overview.md) | [front_spec](frontend/docs/front_spec.md) / [front_build](frontend/docs/front_build.md) / [front_review](frontend/docs/front_review.md) |

**영역 사이의 약속 (계약 문서)**

| 문서 | 누구 사이 |
|------|-----------|
| [docs/contracts/db_contract.md](docs/contracts/db_contract.md) (+ [.dbml](docs/contracts/db_contract.dbml)) | DB ↔ 백엔드 |
| [docs/contracts/api_contract.md](docs/contracts/api_contract.md) | 백엔드 ↔ 프론트 |
| [api.md](api.md) | Data Dragon API 목록 (프론트) |

- 현재 상태 문서(`*_overview.md`)는 각 영역 Review가 끝날 때마다 덮어써서 최신으로 유지합니다. 마지막 장에 "해결되지 않은 점"이 있습니다.
- 과정 기록은 작업마다 아래에 이어 붙입니다.
- 작업 규칙과 흐름(Plan → 승인 → Build → Review)은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 로컬 실행

1. 저장소 루트에 `.env`를 만듭니다. 변수 목록은 [.env.example](.env.example)에 있습니다 (`DATABASE_URL`, `RIOT_API_KEY`, `API_BASE_URL` 등).
2. 백엔드 API를 실행합니다.
   ```bash
   cd backend && npm install && npm start
   ```
3. 프론트를 실행하고 http://localhost:3000/champions 를 엽니다.
   ```bash
   cd frontend && npm install && npm run dev
   ```

**데이터 수집**: Riot 개발용 키는 24시간마다 만료되므로, 키를 새로 받아 `.env`에 넣은 뒤 직접 실행합니다. 집계는 매일 05:00(한국 시간)에 DB가 자동으로 합니다.
```bash
cd backend && npm run collect -- run --preset test --players-per-tier 250
```

DB 마이그레이션, 수집 옵션, API 상세는 각 영역의 현재 상태 문서를 봅니다.
