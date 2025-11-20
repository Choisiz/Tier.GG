#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5500}"

queue="${QUEUE:-RANKED_SOLO_5x5}"
page="${PAGE:-1}"
batchSize="${BATCH_SIZE:-20}"

# script dir and project root (backend/scripts -> project root is parent of backend)
SCRIPT_DIR="$(cd -- "$(dirname "$0")" >/dev/null 2>&1; pwd -P)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1; pwd -P)"

say() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

check_health() {
  if ! curl -sSf "${BASE_URL}/healthz" >/dev/null; then
    say "backend not ready at ${BASE_URL}. Start the server first."
    exit 1
  fi
}

db_exec() {
  local sql="$1"
  docker compose -f "${ROOT_DIR}/docker-compose.db.yml" exec -T db psql -U app -d tier -v ON_ERROR_STOP=1 -c "$sql"
}

call() {
  local url="$1"
  shift || true
  say "CALL: ${url} $*"
  curl -sS "${url}" "$@" | { command -v jq >/dev/null 2>&1 && jq . || cat; }
  echo
}

main() {
  check_health

  say "[1/4] 티어 → 플레이어 수집"
  say "CLEAN: players"
  db_exec "TRUNCATE TABLE players RESTART IDENTITY;"
  call "${BASE_URL}/info/player" \
    -G --data-urlencode "queue=${queue}" \
       --data-urlencode "page=${page}"

  say "[2/4] 플레이어 → 매치ID 수집"
  say "CLEAN: matches"
  db_exec "TRUNCATE TABLE matches RESTART IDENTITY;"
  call "${BASE_URL}/info/matches"

  say "[3/4] 매치 상세(클래식만) 수집"
  say "CLEAN: gameinfo*, 순서 중요"
  db_exec "TRUNCATE TABLE gameinfo_perks, gameinfo_bans, gameinfo RESTART IDENTITY;"
  call "${BASE_URL}/info/gameInfo" \
    -G --data-urlencode "batchSize=${batchSize}"

  say "[4/4] 챔피언 집계 저장"
  say "CLEAN: champion"
  db_exec "TRUNCATE TABLE champion RESTART IDENTITY;"
  call "${BASE_URL}/info/champion"

  say "DONE"
}

main "$@"


