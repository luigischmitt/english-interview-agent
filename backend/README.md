# Backend

The backend provides interviewer speech through Kokoro, completed spoken-response transcription through OpenRouter Whisper Large V3 Turbo, and a technical-answer/English-communication assessment from submitted voice transcripts through OpenRouter. The English-formulation route remains a placeholder.

## Run the complete local environment

From the repository root:

```bash
docker compose up --build
```

This starts the frontend at `http://localhost:3000`, the backend at `http://localhost:3001`, and Kokoro at `http://localhost:8880`. Source folders are mounted into the frontend and backend containers, so their development servers reload when code changes.

Stop every service with:

```bash
docker compose down
```

## Run the backend without Docker

```bash
npm install
npm run dev
```

The server runs on `http://localhost:3001` by default.

### Environment variables

The backend does not require Supabase credentials: interview persistence is
performed by the authenticated frontend client. The speech service accepts:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port. |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS. |
| `SPEECH_PROVIDER` | `fake` | `fake` returns deterministic test audio; `kokoro` calls Kokoro. |
| `KOKORO_BASE_URL` | `http://localhost:8880` | Kokoro HTTP base URL. |
| `KOKORO_TIMEOUT_MS` | `15000` | Positive request timeout in milliseconds. |
| `INTERVIEWER_VOICE` | `af_bella+af_heart` | Voice passed to Kokoro. |
| `INTERVIEWER_SPEED` | `1` | Positive default speech speed. |
| `AZURE_SPEECH_KEY` | — | Azure Speech resource key. Required only for voice transcription. Keep it server-side. |
| `AZURE_SPEECH_REGION` | — | Azure Speech resource region, such as `brazilsouth`. Required only for voice transcription. |
| `AZURE_SPEECH_TIMEOUT_MS` | `20000` | Positive Azure Speech request timeout in milliseconds. |
| `AZURE_SPEECH_ASSESSMENT_ENABLED` | `false` | Set to `true` to enable optional experimental pronunciation signals. Requires Azure Speech key and region. |
| `AZURE_SPEECH_ASSESSMENT_TIMEOUT_MS` | `8000` | Positive total deadline shared by ffmpeg conversion and the Azure scripted assessment request. |
| `OPENROUTER_API_KEY` | — | OpenRouter key. Enables the two Whisper transcription choices and stays server-side. |
| `TRANSCRIPTION_TIMEOUT_MS` | `55000` | Overall OpenRouter time budget for the final Whisper transcription, including bounded 429 retries. |
| `TRANSCRIPTION_STREAM_MAX_DURATION_MS` | `180000` | Maximum duration for one PCM WebSocket response. Must be a positive integer. |
| `TRANSCRIPTION_STREAM_MAX_BYTES` | `6291456` | Maximum in-memory PCM bytes per response (6 MiB by default). |
| `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` | `8` | Maximum simultaneous in-memory PCM responses. |
| `TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS` | `4` | Maximum simultaneous final Whisper calls per backend process. |
| `TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS` | `4` | Maximum finalized recordings waiting for a Whisper slot. |
| `INTERVIEW_REASONING_MODEL` | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter model for interview reasoning and next-turn orchestration. Keep this configuration server-side. |
| `INTERVIEW_REASONING_TIMEOUT_MS` | `15000` | Positive timeout in milliseconds for interview reasoning requests. |
| `INTERVIEW_ORCHESTRATION_TIMEOUT_MS` | `6000` | Positive timeout in milliseconds for next-turn orchestration. |
| `INTERVIEW_REASONING_DIAGNOSTICS` | `false` | Set to `true` to include model, latency, and provider-reported cost in next-turn responses. Keep disabled outside local testing. |

Do not add Supabase `service_role` keys or other private credentials to this
service unless a future server-side integration explicitly requires them.

## Run Kokoro with a local backend

From the repository root, start Kokoro in the background:

```bash
docker compose up -d
```

Start the backend with these environment variables to use it (there is no committed `.env` file):

```bash
SPEECH_PROVIDER=kokoro \
KOKORO_BASE_URL=http://localhost:8880 \
INTERVIEWER_VOICE=af_bella+af_heart \
npm run dev
```

The Compose service uses the CPU image and restarts automatically when Docker starts. Stop it with:

```bash
docker compose down
```

When `SPEECH_PROVIDER=fake` (the default), the API returns deterministic test
audio and never requires Docker or Kokoro. The frontend can continue showing
the question and accepting an answer when speech is unavailable; speech is
not a gate for interview practice.

## Current routes

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ "status": "ok" }`. |
| `GET` | `/api/v1/transcriptions/providers` | Returns the configured transcription choices for the local comparison selector. |
| `POST` | `/api/v1/transcriptions` | Receives a completed 16 kHz mono WAV response (maximum 30 seconds), returns a transcription from the selected configured provider. This compatibility route is separate from streaming. Audio is not persisted. |
| `WS` | `/api/v1/transcriptions/stream` | Protocol v2 receives 16 kHz mono signed 16-bit PCM frames plus RMS `level`, then `finalize` or `cancel`. It makes no Whisper requests during capture. On `finalize`, it assembles one WAV directly from in-memory frames, makes one final Whisper request, and returns one `complete` message with the final transcript. Audio is bounded by 180 seconds/6 MiB per session, up to 8 active sessions, 4 concurrent final Whisper requests, and 4 queued final requests by default. Capacity overflow returns a recoverable error. Audio is cleared on completion, error, cancellation, and disconnect; it is never persisted or logged. Optional Azure scripted assessment receives the final WAV and transcript only when audio is at most 30 seconds; longer audio reports `unavailable`. Azure never blocks delivery of the Whisper transcript. |
| `POST` | `/api/v1/thinking` | Assesses technical answer coverage and English communication from a supplied transcript. Uses OpenRouter credentials held by the backend. |
| `POST` | `/api/v1/thinking/next-turn` | Chooses one brief, transcript-grounded follow-up or advances to the next fixed interview question. The model must provide a short literal transcript anchor, validated server-side and omitted from the public response. Provider errors and invalid output deterministically return `NEXT`. |
| `POST` | `/api/v1/thinking/report` | Generates one structured final report from up to 30 ordered question/answer pairs and role context. In the voice-only room, candidate answers are final speech transcripts. It separates technical content, English communication, and practical priorities; it does not assess vocal delivery or return numeric scores. |
| `POST` | `/api/v1/formulations` | Reserved for answer formulation in English; returns `501` until connected. |
| `GET` | `/api/v1/speech/health` | Reports whether the configured speech provider is ready. |
| `GET` | `/api/v1/speech/voices` | Returns the sole approved interviewer persona. |
| `POST` | `/api/v1/speech` | Generates MP3 audio for interviewer text. |

All API errors use `{ "error": { "code": string, "message": string } }`.

### Assess an interview answer

The reasoning route is server-to-server and does not save requests or results.
It asks OpenRouter to route only to providers that deny data collection for the
request; if no matching provider is available, the endpoint returns a
standardized provider error.
It accepts the current question, a transcript, and minimal role context. It
returns an operational technical status plus separate English communication
clarity and evidence-based observations. It does not generate another question,
change the interview sequence, or assess pronunciation, accent, intonation, or
other vocal delivery from text. Scores and private reasoning are not returned.

Example request:

```json
{
  "currentQuestion": "How would you make a REST API more reliable?",
  "transcript": "I would add a timeout and use bounded retries with jitter.",
  "roleContext": {
    "targetRole": "Backend Engineer",
    "seniority": "mid-level",
    "focus": "technical-depth"
  }
}
```

Example response:

```json
{
  "answerStatus": "ADDRESSES_QUESTION",
  "needsClarification": false,
  "technicalSummary": "Describes timeouts and bounded retries with jitter.",
  "englishCommunication": {
    "clarity": "CLEAR",
    "observations": []
  }
}
```

`answerStatus` is `ADDRESSES_QUESTION`, `PARTIAL`, or `UNCLEAR`. `UNCLEAR`
requires `needsClarification: true`; `ADDRESSES_QUESTION` requires it to be
false. Communication clarity is `CLEAR`, `MOSTLY_CLEAR`, or `UNCLEAR`.
Observations are limited to three and use `GRAMMAR`, `WORD_CHOICE`,
`FALSE_COGNATE`, or `STRUCTURE`; each includes an exact text span from the
transcript and a concise suggestion. Empty observations are valid when the
transcript provides no clear evidence for a language note.

The route rejects empty/oversized fields before contacting OpenRouter. Missing
credentials return `THINKING_NOT_CONFIGURED`; upstream rate limits, timeouts,
provider failures, and malformed or inconsistent model output use standardized
error objects with `THINKING_RATE_LIMITED`, `THINKING_TIMEOUT`,
`THINKING_PROVIDER_UNAVAILABLE`, or `THINKING_INVALID_PROVIDER_RESPONSE`.

The final report endpoint accepts only `roleContext` and ordered `turns`
(`sequenceNumber`, `question`, and `answer`). It rejects interview IDs, duplicate
or out-of-order sequence numbers, more than 30 pairs, text over the per-field
limits, or more than 30,000 total question/answer characters. It makes exactly
one OpenRouter request with structured output and provider data collection
denial. Candidate text is untrusted input. English evidence must be an exact
excerpt from one of the supplied answers. The response includes the configured
model and analysis version for persistence; it has no invented scores, full
transcript copy, or hidden reasoning. The backend does not fetch or persist
sessions and does not authorize an interview ID; the authenticated frontend
persists results through Supabase RLS. Provider/configuration errors use the
standardized thinking error object.

### Run the real-time audio E2E harness

This opt-in harness generates an English answer through `/api/v1/speech`,
converts the returned audio to temporary mono 16 kHz s16le PCM with `ffmpeg`,
and sends 100 ms frames at real-time pace through WebSocket protocol v2. It
reports connection, first-speech, silence, queue-wait, and final-transcription
latencies. It uses the normal Kokoro and Whisper paths, including VAD; it does
not run as part of `npm test`. On success, the harness records only transcript
character count and never prints transcript text. Provider failures report
only bounded error categories.

Because the harness generates speech from its supplied `--text` (or the
default synthetic answer), it can also compare the final transcript with that
known reference. The JSON reports only `transcriptSimilarity`: a normalized,
token-level `1 - WER` score in the range 0–1 (case- and accent-insensitive,
clamped at zero). A run is `ok` only at similarity `>= 0.75`, in addition to
the transport/completion checks. This score is emitted only as a number; the
reference and recognized transcript are never included in harness output.

Requirements: start Kokoro and the backend with `SPEECH_PROVIDER=kokoro`, set
`OPENROUTER_API_KEY` in the backend's ignored local `backend/.env`, and install
`ffmpeg` on the machine running the harness. The backend must be reachable at
port 3001. For example, with the local Docker services running:

```bash
cd backend
npm run test:audio-e2e
```

The default synthetic answer is about 35–45 seconds, so it exercises the full
recording path, queue, and final Whisper request. Options can be passed on the command line or
through `AUDIO_E2E_*` environment variables:

```bash
npm run test:audio-e2e -- --backend-url http://localhost:3001 --speed 1 --timeout-ms 120000
```

Supported options are `--backend-url`, `--text`, `--speed`,
`--speech-threshold`, `--timeout-ms`, `--max-duration-seconds`, and `--ffmpeg`.
Their environment equivalents are `AUDIO_E2E_BACKEND_URL`, `AUDIO_E2E_TEXT`,
`AUDIO_E2E_SPEED`, `AUDIO_E2E_SPEECH_THRESHOLD`, `AUDIO_E2E_TIMEOUT_MS`,
`AUDIO_E2E_MAX_DURATION_SECONDS`, and `AUDIO_E2E_FFMPEG`. The URL must be a
plain HTTP(S) origin/path without credentials or query parameters. Keep API
keys in the backend's ignored `.env`; the harness has no credential option and
does not print environment values or transcript text. Use the environment
variable for custom text if it should not appear in shell history.

The harness removes its temporary MP3 and PCM files on success or failure.
Running it incurs local CPU time for Kokoro and one logical final transcription
through the configured Whisper provider (a 429 can trigger up to two bounded
retries). Azure assessment is skipped for this default answer because it is
longer than 30 seconds. Check current provider pricing before repeated runs;
do not use real candidate recordings or credentials as test text.

### Configure Azure Speech locally

Create `backend/.env` locally (it is ignored by Git):

```bash
AZURE_SPEECH_KEY=<your-resource-key>
AZURE_SPEECH_REGION=brazilsouth
OPENROUTER_API_KEY=<your-openrouter-key>
```

Docker Compose loads this file into the backend container when present; it is
optional, so the stack can still start without transcription credentials.
Explicit Compose `environment` values take precedence over values from this
file. Do not put provider credentials in frontend configuration.

`OPENROUTER_API_KEY` enables Whisper Large V3 Turbo for the streaming response path. The browser captures mono PCM at 16 kHz through AudioWorklet and sends 100 ms s16le frames over WebSocket protocol v2. Frames are retained only in backend memory. After the candidate ends the answer, the backend creates one WAV directly from those frames and sends it as multipart audio, avoiding Base64 expansion. No partial transcript is produced. The process accepts up to eight active recordings, runs at most four final Whisper calls concurrently, and queues up to four finalized responses. Queue saturation fails clearly and allows the candidate to retry. OpenRouter has a 55-second overall request budget by default (`TRANSCRIPTION_TIMEOUT_MS`); an HTTP 429 may be retried up to twice within that budget with bounded `Retry-After` handling. VAD uses 3.5 seconds of silence to suggest finalization, while the manual finish remains available. Valid speech remains accepted with trailing silence. The backend clears audio buffers on success, error, cancellation, and disconnect; audio is not persisted or logged and provider keys remain server-side. The legacy WAV route remains available for compatibility and keeps its own 30-second limit.

The same server-side key enables `/api/v1/thinking` and
`/api/v1/thinking/next-turn`. Override the reasoning model or timeout locally
with `INTERVIEW_REASONING_MODEL` and `INTERVIEW_REASONING_TIMEOUT_MS`; these
variables must not be exposed to the browser. The selected default is a stable
Mistral Small 3.2 model, and the reasoning request has a 15-second default
timeout. Provider routing requires structured-output support and denies data
collection. The next-turn route receives the active question, final text
transcript, minimal role context, next fixed question, and whether a follow-up
has already been used for the current planned question. Transcript is treated
as untrusted data. For `FOLLOW_UP`, the model must return an `anchor` of 2–8
words copied literally from the transcript and naturally include that exact
anchor in one short question that acknowledges and deepens a stated technology,
decision, action, difficulty, or result without inventing details. The backend
requires the anchor to occur in both the transcript and question, then removes
it from the public response. `NEXT` requires a null anchor. At most one brief
follow-up is accepted; timeout, rate limiting,
provider errors, missing credentials, or malformed output fall back to
`{"decision":"NEXT","followUpQuestion":null}`. Model, latency, and
provider-reported cost diagnostics can be enabled with the server-only
`INTERVIEW_REASONING_DIAGNOSTICS=true` flag; it defaults off and should remain
off outside local testing. Diagnostics include only model, latency, and
provider-reported cost, never credentials or hidden rationale. Orchestration
uses a separate 6-second timeout by default; answer assessment retains its
15-second timeout. The browser cancels orchestration requests after 7 seconds
so its fallback stays slightly outside the backend timeout.

Set `AZURE_SPEECH_ASSESSMENT_ENABLED=true` to assess the complete final answer using the completed Whisper transcript as scripted `ReferenceText`. Azure short-audio REST assessment is attempted only for answers up to 30 seconds; longer answers receive `unavailable` without an Azure request. The assessment is experimental and may inherit recognition errors from Whisper. Azure failures/timeouts never block or replace the Whisper transcript. These signals are not an English-level, readiness, proficiency, or accent measure. Microsoft's pricing material lists some pronunciation-assessment enhanced features under Standard/pay-as-you-go and Prosody as an additional paid score, so verify current pricing and tier terms for the target resource; this implementation does not assume S0 is required. Keep the toggle off when these costs are not desired. See Microsoft's [Pronunciation Assessment guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [short-audio REST format limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short), and [pricing guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool).

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.
