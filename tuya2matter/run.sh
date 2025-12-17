#!/usr/bin/env bash
set -euo pipefail

OPTIONS_FILE="/data/options.json"
export USER_CODE=""

if [ -f "$OPTIONS_FILE" ]; then
  USER_CODE=$(jq -r '.user_code // empty' "$OPTIONS_FILE")
  TUYA2MQTT_DEBUG=$(jq -r '.tuya2mqtt_debug // empty' "$OPTIONS_FILE")
  VITURAL_SWITCHES=$(jq -r '.vitural_switches // empty' "$OPTIONS_FILE")
  export TUYA2MQTT_DEBUG
  export USER_CODE
  export VITURAL_SWITCHES
fi

echo "[tuya2matter] Starting… USER_CODE='${USER_CODE}'"

# Chạy app bằng Bun
export MATTER_NODEJS_CRYPTO=0
exec bun run ./src/index.ts
