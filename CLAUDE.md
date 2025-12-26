# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tier.GG is a League of Legends champion tier data aggregation and visualization platform. It collects ranked game data from the Riot API, processes statistics, and displays champion tier lists with detailed analytics.

## Development Commands

### Frontend (Next.js 15 + React 19)
```bash
cd frontend
npm run dev      # Start dev server on port 3000 (--hostname 0.0.0.0)
npm run build    # Production build
npm run lint     # ESLint
```

### Backend (Express.js + TypeScript)
```bash
cd backend
npm run dev      # Start with tsx watch on port 5500
npm run build    # Compile TypeScript to dist/
npm run collect  # Run full data collection pipeline
```

### Database
```bash
docker compose -f docker-compose.db.yml up -d  # Start PostgreSQL on port 5433
```

## Architecture

### Data Collection Pipeline

The backend runs a 4-step data collection pipeline orchestrated by `backend/scripts/collect_all.sh`:

1. **Player Collection** (`/info/player`) - Fetches ranked players from Riot API
2. **Match Collection** (`/info/matches`) - Gets recent match IDs for each player
3. **Game Info Collection** (`/info/gameInfo`) - Fetches detailed match data (items, runes, bans)
4. **Champion Aggregation** (`/info/champion`) - Computes champion tier statistics (pick%, win%, ban%)

Rate limiting is handled in-memory via `backend/src/lib/rateLimiter.ts` (9 req/sec, 100 req/120sec for Riot API compliance).

### Database Schema (PostgreSQL)

| Table | Purpose |
|-------|---------|
| `players` | Ranked player data |
| `matches` | Player → Match ID mapping |
| `gameinfo` | Match details (champion, position, items, spells) |
| `gameinfo_bans` | Champion ban data |
| `gameinfo_perks` | Rune/perk selections |
| `champion` | Daily aggregated champion statistics by position |

Schema migrations are in `/db/` directory.

### Frontend Structure

```
frontend/src/
├── app/                    # Next.js App Router
│   ├── (admin)/           # Dashboard layout group
│   │   └── (others-pages)/
│   │       ├── basic-tables/     # Champion tier list page
│   │       └── champions/
│   │           ├── info/[championName]/   # Champion details
│   │           └── skins/[championName]/  # Skins showcase
│   └── api/               # API routes (champion data from DDragon)
├── components/
│   └── tables/            # ChampionTablePanel - main tier list component
├── context/               # ThemeContext (dark/light), SidebarContext
└── lib/                   # Utility functions (champions, runes, items, spells)
```

### Key Patterns

- **Theme Toggle**: Uses `ThemeContext` with localStorage persistence and DOM class toggling
- **Sidebar State**: `SidebarContext` manages navigation, submenus, and mobile responsiveness
- **External Assets**: Champion images, item icons, and spell icons are fetched from `ddragon.leagueoflegends.com`
- **Path Alias**: Use `@/*` to import from `frontend/src/*`

## API Endpoints

### Backend API (port 5500)
- `GET /info/player?queue=RANKED_SOLO_5x5&page=1` - Collect ranked players
- `GET /info/matches?limit=20&puuidLimit=100` - Collect match IDs
- `GET /info/gameInfo?max=1000&batchSize=10` - Collect game details
- `GET /info/champion` - Aggregate champion statistics

### Frontend API Routes
- `/api/champion_info?name=Aatrox` - Champion data from DDragon
- `/api/champion_images?name=Aatrox` - Champion images
- `/api/champion_skins?name=Aatrox` - Champion skins
- `/api/champion_item?itemId=1001` - Item data

## Environment Variables

Required in `.env`:
- `RIOT_API_KEY` - Riot Games API key
- `DATABASE_URL` - PostgreSQL connection string
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` - Database credentials
