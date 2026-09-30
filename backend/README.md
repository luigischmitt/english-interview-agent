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
| `AZURE_SPEECH_ASSESSMENT_TIMEOUT_MS` | `15000` | Positive per-block deadline shared by ffmpeg conversion and one Azure scripted assessment request. |
| `OPENROUTER_API_KEY` | — | OpenRouter key. Enables the two Whisper transcription choices and stays server-side. |
| `TRANSCRIPTION_TIMEOUT_MS` | `55000` | Overall OpenRouter time budget for the final Whisper transcription, including bounded 429 retries. |
| `TRANSCRIPTION_STREAM_MAX_DURATION_MS` | `180000` | Maximum duration for one PCM WebSocket response. Must be a positive integer. |
| `TRANSCRIPTION_STREAM_MAX_BYTES` | `6291456` | Maximum in-memory PCM bytes per response (6 MiB by default). |
| `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` | `8` | Maximum simultaneous in-memory PCM responses. |
| `TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS` | `4` | Maximum simultaneous final Whisper calls per backend process. |
| `TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS` | `4` | Maximum finalized recordings waiting for a Whisper slot. |
| `TRANSCRIPTION_VAD_TRAILING_SILENCE_MS` | `3500` | Silence duration before automatic finalization after speech; maximum `10000`. |
| `TRANSCRIPTION_VAD_FINALIZATION_GRACE_MS` | `1500` | Reversible server-side grace after a silence decision; confirmed resumed activity cancels it; maximum `5000`. |
| `TRANSCRIPTION_VAD_AMBIENT_HOLD_MS` | `8000` | Maximum grace period for ambiguous mid-band activity (quiet speech or room noise); maximum `30000`. |
| `INTERVIEW_REASONING_MODEL` | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter model for interview reasoning and next-turn orchestration. Keep this configuration server-side. |
| `INTERVIEW_REASONING_TIMEOUT_MS` | `15000` | Positive timeout in milliseconds for interview reasoning requests. |
| `INTERVIEW_ORCHESTRATION_TIMEOUT_MS` | `6000` | Positive timeout in milliseconds for next-turn orchestration. |
| `INTERVIEW_REPORT_MODEL` | value of `INTERVIEW_REASONING_MODEL` | OpenRouter model used only for the final interview report (trimmed; blank falls back to `INTERVIEW_REASONING_MODEL`, then the default). Next-turn orchestration keeps using `INTERVIEW_REASONING_MODEL`. The returned `model` field reflects the report model. |
| `INTERVIEW_REPORT_TIMEOUT_MS` | `45000` | Report-only provider deadline in milliseconds; accepts positive values up to `60000`. The browser deadline is 65 seconds by default. |
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
| `WS` | `/api/v1/transcriptions/stream` | Protocol v2 receives 16 kHz mono signed 16-bit PCM frames plus RMS `level`, then `finalize` or `cancel`. It makes no Whisper requests during capture. On `finalize`, it assembles one WAV directly from in-memory frames and makes one canonical Whisper request with `verbose_json` and both word and segment timestamps. It returns one `complete` message with the canonical transcript. Audio is bounded by 180 seconds/6 MiB per session, up to 8 active sessions, 4 concurrent final Whisper requests, and 4 queued final requests by default. Capacity overflow returns a recoverable error. Audio is cleared on completion, error, cancellation, and disconnect; it is never persisted or logged. Optional Azure assessment runs after `complete`, using timestamp-aligned groups with a 25-second target (never over 30 seconds), and emits one aggregate `assessment` message with safe timing, block counts, and a fixed failure category when unavailable. If no usable alignment can be built, one bounded segment-only timing request (12-second deadline) may follow; no more than 2 recovery calls run concurrently and up to 6 additional calls may wait. A waiting retry is removed if its client disconnects. It cannot replace the canonical transcript, and its audio buffer remains temporary. Missing timing or full recovery capacity preserves the transcript and makes assessment unavailable. |
| `POST` | `/api/v1/thinking` | Assesses technical answer coverage and English communication from a supplied transcript. Uses OpenRouter credentials held by the backend. |
| `POST` | `/api/v1/thinking/next-turn` | Prefers one useful, transcript-grounded follow-up when the answer supports it, otherwise chooses a role/focus-adapted main question. The server validates transcript anchors, question bounds, low-information transcripts, and repeated questions. A brief bridge is optional and never quotes the transcript. Provider errors use a neutral transition and the first supplied fixed question that does not repeat covered context; if none remains, the room closes. |
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
(`sequenceNumber`, `question`, and `answer`). It rejects interview IDs, empty
answers, duplicate or out-of-order sequence numbers, more than 30 pairs, text
over the per-field limits, or more than 30,000 total question/answer characters.
It makes exactly one OpenRouter request with structured output and provider data
collection denial. Candidate text is untrusted input. Technical observations,
English patterns, and exercises cite a turn number and short exact excerpt from
that answer; English observations also include a concrete rephrasing. The server
validates each excerpt against its specific answer and discards an invalid
optional item while preserving other valid sections. When language evidence is
missing, the response marks it insufficient. The report has a separate 45-second
provider deadline; the browser waits 65 seconds, and the server deadline can be
raised to at most 60 seconds. The report model is configured separately with `INTERVIEW_REPORT_MODEL`
(falling back to `INTERVIEW_REASONING_MODEL`). The response includes the model used and analysis version
`v2` for persistence; it has no invented scores, full transcript copy, or hidden
reasoning. Vocal delivery remains exclusively Azure-derived in the frontend.
Technical strengths and gaps are evaluated for each question/answer pair; a gap
describes an explanation that was missing from the answer, not a conclusion that
the candidate lacks knowledge. The report avoids classifying tools or claiming
mastery, correctness, ownership, or impact when the answer does not provide
evidence. English feedback can include up to eight distinct prioritized patterns
and omits duplicate findings and excerpts likely to be transcription artifacts.
The backend does not fetch or persist sessions and does not authorize an
interview ID; the authenticated frontend persists results through Supabase RLS.
Provider/configuration errors use the standardized thinking error object.

### Compare report models (opt-in benchmark)

`npm run benchmark:report-models` is not part of `npm test`. It needs
`OPENROUTER_API_KEY` and `REPORT_BENCHMARK_MODELS` (comma-separated OpenRouter
model ids). It runs each synthetic report fixture once per model through the real
report service and validator, then prints only aggregate JSON per model: success
and failure counts by fixed category, median/p90 latency, total and mean
provider-reported cost, and summed evidence accepted/rejected counts by reason.
It never prints fixture text, model output, or credentials. The run aborts when
cumulative cost exceeds `REPORT_BENCHMARK_MAX_USD` (default `0.50`).

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
default synthetic answer), it can compare the final transcript with that
known reference. A versioned synthetic corpus is available with
`--case <name>` (also `AUDIO_E2E_CASE`): `technical`, `acronyms`, `numbers`,
`pauses`, `self-correction`, `quiet`, `noise`, `short`, and `long`. These cases
cover technical terms, acronyms, spoken numbers, natural pauses, corrections,
lower volume, deterministic low-level noise, and response length. The pause
case relies on sentence punctuation in its TTS reference, so silence falls at
a known sentence boundary; it does not splice the waveform. Quiet and noise
profiles transform the generated PCM deterministically before streaming; no
audio fixture is checked into the repository. Use one
case per run when debugging a scenario. `--suite` runs every case in sequence
and returns one aggregate; `AUDIO_E2E_SUITE=true` is equivalent. Case names
are never included in output.

The `quiet` case uses speech threshold `0.015`, the low end of the threshold
range produced by browser calibration in a quiet room. Other cases use the
default `0.025`; an explicit `--speech-threshold` or
`AUDIO_E2E_SPEECH_THRESHOLD` overrides case defaults. In the `numbers` case,
the comparison normalizes English cardinal words and digits (for example,
“ninety nine” and “99”) for that case's metrics only; it never rewrites the
canonical Whisper transcript. Configured thresholds are limited to `0.015`
through `0.05`, matching the range accepted by the streaming VAD.

The JSON reports only aggregate `transcriptSimilarity` (normalized token-level
`1 - WER`, case- and accent-insensitive, clamped to 0–1), `expectedWords`,
`omittedWords`, `substitutedWords`, and `insertedWords`; reference and
recognized text are never included. Timing includes `queueWaitMs`,
`transcriptionMs` (from transcription-started to complete), and
`finalizationToCompleteMs`. Similarity must be `>= 0.75` for a run to be `ok`,
in addition to transport/completion checks. Corpus references and evaluation
code are versioned together; these synthetic results are regression signals,
not estimates of real-candidate accuracy.

Suite output contains only case count, successful case count, mean similarity,
summed word counts, and mean queue, Whisper, and finalize-to-complete latency.
It makes one speech-generation and one final-transcription request per case
(with normal bounded retry behavior), so use it deliberately.

Requirements: start Kokoro and the backend with `SPEECH_PROVIDER=kokoro`, set
`OPENROUTER_API_KEY` in the backend's ignored local `backend/.env`, and install
`ffmpeg` on the machine running the harness. The backend must be reachable at
port 3001. For example, with the local Docker services running:

```bash
cd backend
npm run test:audio-e2e
```

The default synthetic answer is about 35–45 seconds, so it exercises the full
recording path, queue, and final Whisper request. Options can be passed on the
command line or through `AUDIO_E2E_*` environment variables:

```bash
npm run test:audio-e2e -- --backend-url http://localhost:3001 --speed 1 --timeout-ms 120000
npm run test:audio-e2e -- --case acronyms --timeout-ms 120000
npm run test:audio-e2e -- --suite --timeout-ms 120000
```

To wait for the post-completion Azure assessment and require an available
segmented result, add `--require-assessment` or set
`AUDIO_E2E_REQUIRE_ASSESSMENT=true`. The wait is bounded to 30 seconds (or
`--timeout-ms`, if shorter). The default remains off, so standard harness runs
finish as soon as final transcription completes. When enabled, the JSON
includes only assessment status, segmented status, assessed duration, and
booleans indicating which aggregate score dimensions are available; it never
prints score values or assessment text. If the socket closes first, or the
assessment deadline expires, `assessmentStatus` is `closed` or `timeout` and
the run fails without extending the wait indefinitely.

Supported options are `--backend-url`, `--text`, `--case`, `--suite`,
`--speed`, `--speech-threshold`, `--timeout-ms`, `--max-duration-seconds`,
and `--ffmpeg`. Their environment equivalents are `AUDIO_E2E_BACKEND_URL`,
`AUDIO_E2E_TEXT`, `AUDIO_E2E_CASE`, `AUDIO_E2E_SUITE`, `AUDIO_E2E_SPEED`,
`AUDIO_E2E_SPEECH_THRESHOLD`, `AUDIO_E2E_TIMEOUT_MS`,
`AUDIO_E2E_MAX_DURATION_SECONDS`, `AUDIO_E2E_FFMPEG`, and
`AUDIO_E2E_REQUIRE_ASSESSMENT` (`true` enables the optional assessment wait).
The URL must be a
plain HTTP(S) origin/path without credentials or query parameters. Keep API
keys in the backend's ignored `.env`; the harness has no credential option and
does not print environment values or transcript text. Use the environment
variable for custom text if it should not appear in shell history.

The harness removes its temporary MP3 and PCM files on success or failure.
Running it incurs local CPU time for Kokoro and one logical final transcription
through the configured Whisper provider (a 429 can trigger up to two bounded
retries). When Azure assessment is enabled and Whisper returns valid word
timestamps, the long default answer can trigger multiple aligned Azure calls
with at most two concurrent requests. Check current provider pricing before repeated runs;
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

`OPENROUTER_API_KEY` enables Whisper Large V3 Turbo for the streaming response path. The browser captures mono PCM at 16 kHz through AudioWorklet and sends 100 ms s16le frames over WebSocket protocol v2. Frames are retained only in backend memory. After the candidate ends the answer, the backend creates one WAV directly from those frames and sends it as multipart audio, avoiding Base64 expansion. No partial transcript is produced. The process accepts up to eight active recordings, runs at most four final Whisper calls concurrently, and queues up to four finalized responses. Queue saturation fails clearly and allows the candidate to retry. OpenRouter has a 55-second overall request budget by default (`TRANSCRIPTION_TIMEOUT_MS`); an HTTP 429 may be retried up to twice within that budget with bounded `Retry-After` handling. The primary request asks for both word and segment timings. If neither produces a usable, transcript-aligned Azure block, a single segment-only recovery request may run with a 12-second active provider deadline outside the scarce final-transcription queue slot. Recovery has its own cap of two active calls and six waiting calls; a disconnected waiting session is removed from the queue. It uses the same temporary WAV and the same Whisper model; Azure reference text is always taken from the canonical primary transcript, and only exact matching timestamped phrases are assessed. This can add a second audio-transcription charge only on fallback cases. The 12-second limit applies to the active provider request; bounded recovery-queue wait may add latency to the optional Azure result. Neither recovery nor queue wait delays the already-sent transcript or next interview turn. VAD signals after 3.5 seconds of confident trailing silence, then keeps receiving audio for a reversible 1.5-second server-side grace plus the 300 ms activity-confirmation interval. Confirmed resumed activity cancels that handoff; otherwise the response is finalized in about 5.3 seconds from silence onset. Ambiguous sustained mid-band activity gets an 8-second bounded grace period, then finalizes with an `ambient_activity` reason so changing room noise cannot hold capture open indefinitely. Calibration uses the least active initial frame, falls back to a conservative voice threshold if every calibration frame is elevated, and caps the calibrated threshold at 0.05. The interface has no manual answer-finalization control. Audio continues accumulating in memory until automatic finalization, preserving the full response and pauses. The backend clears audio buffers on success, error, cancellation, and disconnect; audio is not persisted or logged and provider keys remain server-side. Operational diagnostics contain only a coarse calibration band, finalization reason, and timing metadata. The legacy WAV route remains available for compatibility and keeps its own 30-second limit.

The same server-side key enables `/api/v1/thinking` and
`/api/v1/thinking/next-turn`. Override the reasoning model or timeout locally
with `INTERVIEW_REASONING_MODEL` and `INTERVIEW_REASONING_TIMEOUT_MS`; these
variables must not be exposed to the browser. The selected default is a stable
Mistral Small 3.2 model, and the reasoning request has a 15-second default
timeout. Provider routing requires structured-output support and denies data
collection. The next-turn route receives the active question, final text
transcript, minimal role context, next fixed question, whether a follow-up
has already been used for the current planned question, and the questions
already asked. Transcript is treated as untrusted data. The model looks for a
useful follow-up first, but can proceed when no safe, specific thread exists.
For `FOLLOW_UP`, it returns an `anchor` of 1–8 literal transcript words and
one short question that deepens a stated technology, decision, action,
difficulty, or result. The backend requires the anchor to occur in both the
transcript and question, rejects obvious noise and duplicate questions, then
removes the anchor from the public response. `NEXT` requires a null anchor. A
brief natural bridge is optional and cannot quote transcript text. Noise-only
answers skip the provider call and use a neutral transition. At most one
follow-up is accepted per planned question; timeout, rate limiting, provider
errors, missing credentials, or malformed output use a neutral transition and
the first remaining fixed question that is not repetitive, or close the room
when no safe planned question remains. Model, latency, provider-reported cost,
and decision diagnostics can be enabled with the server-only
`INTERVIEW_REASONING_DIAGNOSTICS=true` flag; it defaults off. With the flag on,
decision events contain only the accepted decision or deterministic fallback,
any valid model decision that was rejected, a fixed reason category,
`followUpUsed`, and latency. They never contain a question, transcript, anchor,
model name, session identifier, credential, or raw provider response.
Provider-reported cost and model details are returned only when this flag is
enabled. No orchestration decision or fallback diagnostics are logged while the
flag is off. Unsafe optional acknowledgments
are dropped without discarding a valid question. Orchestration
uses a separate 6-second timeout by default; answer assessment retains its
15-second timeout. The browser cancels orchestration requests after 7 seconds
so its fallback stays slightly outside the backend timeout.

Set `AZURE_SPEECH_ASSESSMENT_ENABLED=true` to assess the final answer using timestamps from the canonical Whisper transcript. The primary Whisper request asks OpenRouter for `verbose_json` and both word- and segment-level timestamps. When word timings are usable, the backend groups adjacent words deterministically into audio slices targeted at 25 seconds each, preserving pauses inside a group. When word timing is missing or cannot produce a safe block, usable segment timings are considered. If there is still no transcript-aligned block, one bounded segment-only recovery request may run; its timing is accepted only for phrases that match in order against the canonical transcript, and untimed gaps are not bridged. Each Azure scripted `ReferenceText` contains only canonical words aligned to its matching slice. At most two Azure requests run concurrently. Scores are duration-weighted across successful slices; any successful score dimensions are returned in one `available` assessment with `segmented: true`, and total Azure failure or unusable timing returns `unavailable`. Assessment and timing recovery start after the `complete` transcript event, so they never delay or replace the transcript. Per-answer diagnostics report only durations, timing source/recovery outcome, accepted versus received timestamp counts, queue/provider timings, block counts, and fixed failure categories; they never include audio, transcript, score values, or credentials. Disabled configuration is logged as a fixed reason (`disabled_by_config`, `missing_key`, or `missing_region`). The frontend allows up to 10 seconds for pending assessments when the report begins and applies later results to the visible and persisted summary. The assessment is experimental and may inherit recognition errors from Whisper. These signals are not an English-level, readiness, proficiency, or accent measure. Microsoft's pricing material lists some pronunciation-assessment enhanced features under Standard/pay-as-you-go and Prosody as an additional paid score, so verify current pricing and tier terms for the target resource; this implementation does not assume S0 is required. Keep the toggle off when these costs are not desired. See Microsoft's [Pronunciation Assessment guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [short-audio REST format limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short), and [pricing guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool).

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.
