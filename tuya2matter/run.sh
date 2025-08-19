#!/usr/bin/env bash
set -euo pipefail

OPTIONS_FILE="/data/options.json"
export USER_CODE=""

if [ -f "$OPTIONS_FILE" ]; then
  USER_CODE=$(jq -r '.user_code // empty' "$OPTIONS_FILE")
  export USER_CODE
fi

echo "[tuya2matter] Starting… USER_CODE='${USER_CODE}'"

# Chạy app bằng Bun
exec bun run ./src/index.ts
