#!/usr/bin/env bash
set -euo pipefail

# Usage: auto_commit.sh <type> "<summary>"
# Example: auto_commit.sh feat "챔피언 스킨 API 추가"

TYPE=${1:-chore}
SUMMARY=${2:-"자동 커밋"}

REPO_ROOT="/Users/johnnyseo/Desktop/master/Tier.GG"
cd "$REPO_ROOT"

# Stage all changes respecting .gitignore
git add -A || true

# Unstage sensitive files explicitly
SENSITIVE_PATTERNS=(".env" ".env.*" "*.pem" "*.key")
for pat in "${SENSITIVE_PATTERNS[@]}"; do
  MODIFIED_FILES=$(git ls-files -m -- "$pat" 2>/dev/null || true)
  UNTRACKED_FILES=$(git ls-files -o --exclude-standard -- "$pat" 2>/dev/null || true)
  if [ -n "${MODIFIED_FILES}" ]; then
    git reset -q -- ${MODIFIED_FILES} || true
  fi
  if [ -n "${UNTRACKED_FILES}" ]; then
    git rm --cached -q -- ${UNTRACKED_FILES} || true
  fi
done

# Skip if nothing staged
if git diff --cached --quiet; then
  echo "No staged changes to commit."
  exit 0
fi

# Build commit message
CHANGED_FILES=$(git diff --cached --name-only | sed 's/^/- /')
BODY=$'변경 파일:\n'"$CHANGED_FILES"

# Commit with Korean message
git commit -m "${TYPE}: ${SUMMARY}" -m "$BODY"

echo "✅ Committed: ${TYPE}: ${SUMMARY}"
