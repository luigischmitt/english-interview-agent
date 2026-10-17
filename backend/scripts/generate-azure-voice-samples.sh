#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
env_file="${ENV_FILE:-$repo_root/backend/.env}"
output_dir="$repo_root/frontend/public/voices"

if [[ ! -f "$env_file" ]]; then
  echo "Missing $env_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

: "${AZURE_SPEECH_KEY:?AZURE_SPEECH_KEY is required in backend/.env}"
: "${AZURE_SPEECH_REGION:?AZURE_SPEECH_REGION is required in backend/.env}"
mkdir -p "$output_dir"

sample_text='Hello, I am your interviewer. Take your time and tell me about a project you are proud of.'
voices=(en-US-AndrewNeural en-US-BrianNeural en-US-GuyNeural en-GB-RyanNeural en-US-AvaNeural en-US-EmmaNeural en-US-JennyNeural en-GB-SoniaNeural)

for voice in "${voices[@]}"; do
  curl --fail --silent --show-error \
    --request POST "https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1" \
    --header "Ocp-Apim-Subscription-Key: ${AZURE_SPEECH_KEY}" \
    --header "Content-Type: application/ssml+xml" \
    --header "X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3" \
    --data "<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>${sample_text}</voice></speak>" \
    --output "$output_dir/${voice}.mp3"
done
