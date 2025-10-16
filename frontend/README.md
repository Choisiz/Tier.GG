# GET /api/champion_images

LoL 챔피언 이미지 URL 목록을 반환합니다.

---

## ✅ 요청

- **Method**: `GET`
- **Query Params**:
  - `version` (선택): 데이터 드래곤 버전 (예: `15.11.1`)
  - `lang` (선택): 언어 코드 (기본: `ko_KR`)

### 성공 (200)
```json
{
  "version": "15.11.1",
  "championImageUrls": [
    {
      "name": "Ahri",
      "url": "https://ddragon.leagueoflegends.com/cdn/15.11.1/img/champion/Ahri.png"
    }
    // ...
  ]
}
```


## 콘텐트 및 api 정리

### 챔피언 썸네일 이미지
- 챔피언 썸네일 이미지 api: ✅
### 챔피언 티어리스트(티어, 승률, 픽률, 벤률)
- 티어별 api
- 패치별 api(3개정도)
- 개별 api서버 검토
### 침패언별 정보
  - 챔피언별 메인이미지 api:
  - 챔피언별 스킨이미지 ap: ✅
  - 챔피언별 갈수있는 라인 api
    - Tank,Mage,Support,Assassin,Fighter,Marksman
  - 챔피언별 핵심빌드 api(표본,픽률,승률)(3개정도):티어별,패치별,라인별
  - 챔피언별 시작아이템 api(표본,픽률,승률)(2개정도):티어별,패치별,라인별
  - 챔피언별 아이템 api(픽률,승률)
  - 챔피언별 상대하기 쉬운 챔피언 api(표본,승률):티어별,패치별,라인별
  - 챔피언별 상대하기 어려운 챔피언 api(표본,승률):티어별,패치별,라인별
  - 챔피언별 룬세팅 api(표본,픽률,승률)(3개정도):티어별,패치별,라인별
  - 챔피언별 소환사주문 api(표본,픽률,승률)(2개):티어별,패치별,라인별
  - 챔피언별 스킬순서 api(표본,픽률,승률): 티어별,패치별,라인별
  - 챔피언별 스킬정보api: ✅ 
  - 챔피언별 능력치정보api: ✅
  - 챔피언별 요약정보 api (ai 서비스 도입검토)
  - 티어 이미지 api
  - 포지션 이미지 api

### 전적검색 정보 
  - 닉네임조회 api

### 시스템 구조도
lol-analyzer/
├── docker-compose.yml           # 모든 서비스 관리
├── .env                        # 환경변수
├── .gitignore
├── README.md
│
├── frontend/                   # Next.js 프론트엔드
│   ├── package.json
│   ├── next.config.js
│   ├── pages/
│   │   ├── index.js           # 메인 페이지
│   │   ├── summoner/[name].js # 개인 분석 페이지  
│   │   └── api/               # Next.js API Routes
│   │       ├── champions.js   # 정적 데이터
│   │       └── items.js       # 정적 데이터
│   ├── components/
│   ├── styles/
│   └── public/
│
├── api/                       # Express API 서버
│   ├── package.json
│   ├── server.js              # 메인 서버
│   ├── routes/
│   │   ├── summoner.js        # 소환사 관련 API
│   │   ├── challenger.js      # 챌린저 관련 API
│   │   └── meta.js           # 메타 분석 API
│   ├── services/
│   │   ├── riotAPI.js        # Riot API 호출
│   │   └── analysis.js       # 데이터 분석 로직
│   ├── prisma/
│   │   ├── schema.prisma     # DB 스키마
│   │   └── migrations/       # DB 마이그레이션
│   └── utils/
│
├── airflow/                   # Airflow 설정
│   ├── dags/                 # DAG 파일들
│   │   ├── challenger_daily.py    # 챌린저 데이터 수집
│   │   ├── meta_analysis.py       # 메타 분석
│   │   └── cleanup.py            # 데이터 정리
│   ├── logs/                 # 로그 폴더
│   ├── plugins/              # 커스텀 플러그인
│   └── config/
│       └── airflow.cfg       # Airflow 설정
│
├── database/                  # DB 초기 설정
│   ├── init.sql              # PostgreSQL 초기 스키마
│   └── seed.sql              # 초기 데이터
│
└── scripts/                  # 유틸리티 스크립트
    ├── setup.sh              # 초기 환경 설정
    └── deploy.sh             # 배포 스크립트
