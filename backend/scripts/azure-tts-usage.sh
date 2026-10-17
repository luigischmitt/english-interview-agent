#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${CLOUD_RUN_SERVICE:-english-interview-backend}"
MONTH_START="$(date -u +%Y-%m-01T00:00:00Z)"
CHARS="$(gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE_NAME}\" AND jsonPayload.event=\"speech_usage\" AND jsonPayload.provider=\"azure\" AND timestamp >= \"${MONTH_START}\"" --limit=1000000 --format=json | jq '[.[].jsonPayload.chars] | add // 0')"
PERCENT="$(awk -v chars="$CHARS" 'BEGIN { printf "%.2f", chars * 100 / 500000 }')"
printf 'Azure TTS characters this month: %s / 500000 (%s%%)\n' "$CHARS" "$PERCENT"
