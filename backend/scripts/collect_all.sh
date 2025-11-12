#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5500}"

queue="${QUEUE:-RANKED_SOLO_5x5}"
page="${PAGE:-1}"
limit="${LIMIT:-5}"
puuidLimit="${PUUID_LIMIT:-0}" # 0 = 전체
max="${MAX:-0}"                # 0 = 무제한
batchSize="${BATCH_SIZE:-20}"

say() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

check_health() {
  if ! curl -sSf "${BASE_URL}/healthz" >/dev/null; then
    say "backend not ready at ${BASE_URL}. Start the server first."
    exit 1
  fi
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

  say "[1/3] 티어 → 플레이어 수집"
  call "${BASE_URL}/info/tier/puuid" \
    -G --data-urlencode "queue=${queue}" \
       --data-urlencode "page=${page}"

  say "[2/3] 플레이어 → 매치ID 수집"
  # puuidLimit=0 이면 쿼리로는 넣지 않아 전체 사용
  if [[ "${puuidLimit}" == "0" ]]; then
    call "${BASE_URL}/info/matches/matches10" \
      -G --data-urlencode "limit=${limit}"
  else
    call "${BASE_URL}/info/matches/matches10" \
      -G --data-urlencode "limit=${limit}" \
         --data-urlencode "puuidLimit=${puuidLimit}"
  fi

  say "[3/3] 매치 상세(클래식만) 수집"
  call "${BASE_URL}/info/gameInfo/gameInfo" \
    -G --data-urlencode "max=${max}" \
       --data-urlencode "batchSize=${batchSize}"

  say "DONE"
}

main "$@"


