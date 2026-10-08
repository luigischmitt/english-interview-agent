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

Production deploy (Cloud Run): see [`docs/deploy.md`](../docs/deploy.md).

The backend needs only the public Supabase project URL, to verify access tokens
(see "Authentication"); it never holds Supabase keys: interview persistence is
performed by the authenticated frontend client. The speech service accepts:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port. |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | Browser origin allowed by CORS. |
| `SUPABASE_URL` | — | Public Supabase project URL (same value as the frontend's `NEXT_PUBLIC_SUPABASE_URL`). Required while `BACKEND_AUTH_REQUIRED` is `true`; must be `https` (or `http` for `localhost`/`127.0.0.1`). The backend fails at startup without it. |
| `SUPABASE_PUBLISHABLE_KEY` | — | Optional public key (same value as the frontend's `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; recommended). Enables the remote token check described under Authentication; without it, only ES256 tokens with a known `kid` are accepted. |
| `BACKEND_AUTH_REQUIRED` | `true` | `false` disables access-token checks (local development only; a content-free `auth_disabled` warning is logged at startup). Any value other than `true`/`false` fails at startup. |
| `SPEECH_PROVIDER` | `fake` | `fake` returns deterministic test audio; `kokoro` calls a Kokoro server; `openrouter` calls Kokoro through OpenRouter; `kokoro-openrouter` (hybrid) uses self-hosted Kokoro first with OpenRouter as the hedge. |
| `KOKORO_URL` | — | Kokoro HTTP base URL, e.g. the private Cloud Run service. Required with `kokoro-openrouter`; with `kokoro` it takes precedence over `KOKORO_BASE_URL`. |
| `KOKORO_BASE_URL` | `http://localhost:8880` | Kokoro HTTP base URL when `KOKORO_URL` is unset (local Docker). |
| `KOKORO_AUTH` | `none` | `gcp-id-token` sends `Authorization: Bearer <Google identity token>` (audience = the Kokoro URL origin, from the metadata server) on every Kokoro request, health included. |
| `HYBRID_SPEECH_HEDGE_AFTER_MS` | `2500` | Integer 0-30000. With `kokoro-openrouter`, OpenRouter starts if Kokoro has produced no audio after this delay; a fast Kokoro failure starts it immediately. `0` disables the timed hedge (failures still fall back). |
| `OPENROUTER_SPEECH_VOICE` | `am_echo` | Default interviewer voice with `openrouter` (and the OpenRouter voice with `kokoro-openrouter`); single voices only, blends are rejected. The default lives in `openRouterDefaultVoice` (`src/speech/config.ts`, from `src/speech/voices.ts`). Clients may request any voice in `selectableVoiceList` via an optional `voice` field on `POST /speech` and `POST /thinking/next-turn`; other values fall back to this default. With `kokoro-openrouter` the per-provider voices win. |
| `KOKORO_TIMEOUT_MS` | `15000` | Positive request timeout in milliseconds (also used by `openrouter` and as the overall deadline of `kokoro-openrouter`). |
| `INTERVIEWER_VOICE` | `af_bella+af_heart` (with `openrouter`: `OPENROUTER_SPEECH_VOICE`, then `am_echo`) | Voice passed to the provider. Blends containing `+` are rejected at startup with `openrouter`. |
| `OPENROUTER_SPEECH_MODEL` | `hexgrad/kokoro-82m` | Speech model when `SPEECH_PROVIDER=openrouter`. Requires `OPENROUTER_API_KEY`, otherwise the backend fails at startup. |
| `OPENROUTER_SPEECH_HEDGE_AFTER_MS` | `2000` | Integer 0-10000. With `openrouter`, synthesis goes to DeepInfra first; if it has not answered after this delay (or fails sooner), a second request routed to Together starts and the first successful response wins. `0` disables hedging. |
| `SPEECH_CACHE_TTL_MS` | `60000` | 0-600000. Finished audio and in-flight syntheses are shared by identical `/speech` requests (key: normalized text + voice + speed + format); `0` turns the cache and prefetch off. |
| `SPEECH_STATIC_CACHE_TTL_MS` | `3600000` | Lifetime of the fixed phrases (acknowledgements, closing line). |
| `SPEECH_PREFETCH` | `1` | `0` stops the server synthesizing the next utterance when `POST /thinking/next-turn` produces a decision. |
| `SPEECH_PREFETCH_CHUNKS` | `1` | 1-4. How many leading chunks of the next utterance are synthesized ahead (the first is what delays the voice). |
| `SPEECH_PREFETCH_STATIC` | `1` | `0` skips synthesizing the fixed phrases at startup. |
| `OPENROUTER_SPEECH_URL` | `https://openrouter.ai/api/v1/audio/speech` | Speech endpoint override, mainly for tests. |
| `INTERVIEWER_SPEED` | `1` | Positive default speech speed. |
| `AZURE_SPEECH_KEY` | — | Azure Speech resource key. Required only for voice transcription. Keep it server-side. |
| `AZURE_SPEECH_REGION` | — | Azure Speech resource region, such as `brazilsouth`. Required only for voice transcription. |
| `AZURE_SPEECH_TIMEOUT_MS` | `20000` | Positive Azure Speech request timeout in milliseconds. |
| `AZURE_SPEECH_ASSESSMENT_ENABLED` | `false` | Set to `true` to enable optional experimental pronunciation signals. Requires Azure Speech key and region. |
| `AZURE_SPEECH_ASSESSMENT_TIMEOUT_MS` | `15000` | Positive per-block deadline shared by ffmpeg conversion and one Azure scripted assessment request. |
| `OPENROUTER_API_KEY` | — | OpenRouter key. Enables the two Whisper transcription choices and stays server-side. |
| `TRANSCRIPTION_WHISPER_PROMPT` | `on` | `on` or `off`. When on, every Whisper request carries a `prompt` (vocabulary biasing): a short tech glossary (Supabase, Vercel, Next.js, ...), the interviewer question from the stream `start` message and, for incremental segments, the last ~200 characters of the transcript so far, capped at 800 characters. Never logged. If OpenRouter rejects the field with a 400 mentioning `prompt`, the request is retried once without it and the prompt is disabled for the process. A transcript that merely echoes the prompt is treated as empty. Set `off` to roll back. |
| `TRANSCRIPTION_TIMEOUT_MS` | `55000` | Overall OpenRouter time budget for the final Whisper transcription, including bounded 429 and transient-failure retries. |
| `TRANSCRIPTION_STREAM_MAX_DURATION_MS` | `180000` | Maximum duration for one PCM WebSocket response. Must be a positive integer. |
| `TRANSCRIPTION_STREAM_MAX_BYTES` | `6291456` | Maximum in-memory PCM bytes per response (6 MiB by default). |
| `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` | `20` | Maximum simultaneous in-memory PCM responses per instance; configurable from 1 to 20 to match Cloud Run concurrency. With the 6 MiB default, raw PCM plus one finalization WAV copy is bounded to about 240 MiB at the ceiling. |
| `TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS` | `4` | Maximum simultaneous final Whisper calls per backend process. |
| `TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS` | `4` | Maximum finalized recordings waiting for a Whisper slot. |
| `TRANSCRIPTION_HEDGE_AFTER_MS` | `4000` | If a Whisper call is still pending after this delay and a concurrency slot is free, one identical extra call is started and the first success wins (ENG-90). `0` disables hedging; maximum `30000`. A hedge is an extra Whisper call only on slow requests (Whisper costs about US$0.01 per audio hour). |
| `TRANSCRIPTION_VAD_TRAILING_SILENCE_MS` | `3500` | Silence duration before automatic finalization after speech; maximum `10000`. |
| `TRANSCRIPTION_VAD_FINALIZATION_GRACE_MS` | `1500` | Reversible server-side grace after a silence decision; confirmed resumed activity cancels it; maximum `5000`. |
| `TRANSCRIPTION_VAD_AMBIENT_HOLD_MS` | `8000` | Maximum grace period for ambiguous mid-band activity (quiet speech or room noise); maximum `30000`. |
| `TRANSCRIPTION_PROVIDER` | `whisper-incremental` | Whisper (incremental, via OpenRouter) is the only answer-transcription engine. The legacy values `cartesia` and `whisper` are still accepted and mapped to `whisper-incremental` with a one-time startup warning (`transcription_provider`, `legacy_value_mapped`); remove them from deployed environments. Any other value fails at startup. |
| `TRANSCRIPTION_ANSWER_GRACE_MS` | `3500` | After a transcribed turn whose text ends like a complete sentence, wait this long for more speech before ending the answer; `500` to `10000`. |
| `TRANSCRIPTION_INCOMPLETE_GRACE_MS` | `6000` | Grace after a turn that looks unfinished (no final punctuation or a trailing connector such as "because", "and", "the"), so a thinking pause is not cut; `500` to `15000`. |
| `TRANSCRIPTION_PREPARE_AFTER_MS` | `1200` | After a turn end with no resumed local VAD speech for this long, send `answer-provisional` so the browser can prepare the next question during the grace. `0` disables; it only applies when smaller than the grace that is running; `0` to `10000`. |
| `TRANSCRIPTION_MAX_PREPARES` | `3` | Maximum `answer-provisional` messages per answer; `0` to `3`. The third revision is reserved for a pause that may end the answer. |
| `TRANSCRIPTION_MAX_SEMANTIC_CHECKS` | `2` | Maximum semantic end-of-answer checks per answer; `0` to `5`. |
| `TRANSCRIPTION_SEMANTIC_END_ENABLED` | `true` | Set `false` to disable the semantic end-of-answer check (see "Semantic end of answer"). It also needs `OPENROUTER_API_KEY`. |
| `TRANSCRIPTION_SEMANTIC_END_TIMEOUT_MS` | `1500` | Timeout of the semantic end classifier call; `200` to `5000`. A timeout keeps the normal grace. |
| `TRANSCRIPTION_PAUSE_MS` | `800` | Local VAD silence that counts as a turn end and a segment cut; `300` to `3000`. |
| `INTERVIEW_REASONING_MODEL` | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter model for interview reasoning and next-turn orchestration. Keep this configuration server-side. |
| `INTERVIEW_REASONING_TIMEOUT_MS` | `15000` | Positive timeout in milliseconds for interview reasoning requests. |
| `INTERVIEW_ORCHESTRATION_TIMEOUT_MS` | `6000` | Positive overall deadline in milliseconds for one next-turn decision, shared by every provider call (retry and hedge included). |
| `INTERVIEW_ORCHESTRATION_HEDGE_AFTER_MS` | `2500` | If the provider has not answered after this many milliseconds, one identical request is started and the first response that passes validation wins; the other is aborted. `0` disables hedging. |
| `INTERVIEW_BRIDGE_TIMEOUT_MS` | `1800` | Timeout in milliseconds of the small second call that writes the spoken bridge before the next question; clamped to `300`–`5000`. It never exceeds the remaining part of the overall next-turn deadline and is skipped when less than 1200 ms remain. |
| `INTERVIEW_REPORT_MODEL` | value of `INTERVIEW_REASONING_MODEL` | OpenRouter model used only for the final interview report (trimmed; blank falls back to `INTERVIEW_REASONING_MODEL`, then the default). Next-turn orchestration keeps using `INTERVIEW_REASONING_MODEL`. The returned `model` field reflects the report model. |
| `INTERVIEW_REPORT_TIMEOUT_MS` | `45000` | Report-only provider deadline in milliseconds; accepts positive values up to `60000`. The browser deadline is 65 seconds by default. |
| Per-turn report analysis | `6000` | Hard server-side provider deadline for one answer, including response reading. Degenerate provider output is not retried; caller disconnects abort upstream work. |
| `INTERVIEW_REASONING_DIAGNOSTICS` | `false` | Set to `true` to include model, latency, and provider-reported cost in next-turn responses. Keep disabled outside local testing. |
| `INTERVIEW_SPECULATIVE_HANDOFF` | `off` | Set to `on` to enable the short speculative turn-analysis endpoint. This server-side switch is checked on every request, so rollback does not require a frontend deploy. |

Do not add Supabase `service_role` keys or other private credentials to this
service unless a future server-side integration explicitly requires them.

The stream limits are per backend instance. At 20 Cloud Run request slots and
50 instances, the configured ceiling is 1,000 live stream sessions; the separate
finalization queue remains capped at 4 active plus 4 waiting per instance
(200 active plus 200 waiting across 50 instances). This is limit arithmetic,
not a throughput or latency guarantee; actual capacity depends on audio length,
provider latency, memory headroom, and Cloud Run scaling.

## Interviewer voice via OpenRouter

Production has no Kokoro server, so `SPEECH_PROVIDER=openrouter` synthesizes the
interviewer with the same Kokoro model (`hexgrad/kokoro-82m`) through OpenRouter,
reusing `OPENROUTER_API_KEY`, which stays server-side. Measured latency was
1.5-1.9 s per question. Cost is about US$0.62 per 1M characters on DeepInfra;
the OpenRouter price is not confirmed. Only single voices work (default
`af_heart`): blends such as `af_bella+af_heart` return HTTP 400 upstream, so
they are rejected at startup. `speed` is sent only when `INTERVIEWER_SPEED`
is not `1` (verified live), and every request asks OpenRouter for
`data_collection: "deny"`. `/api/v1/speech/health` reports `ready` without calling OpenRouter.
Upstream latency varies a lot (0.5-10 s), so requests are hedged: the primary asks
OpenRouter to prefer DeepInfra, and after `OPENROUTER_SPEECH_HEDGE_AFTER_MS` a second
request prefers Together (about 6x the price, paid only when the hedge starts); the loser is aborted.
The `speech_synthesis_timing` log gains a content-free `hedge` field:
`not_needed`, `primary_won`, `hedge_won` or `both_failed`.
When synthesis fails, the API returns `503 SPEECH_PROVIDER_UNAVAILABLE` and the
frontend keeps showing the question as text with an audio-unavailable message.

## Interviewer voice: self-hosted Kokoro with OpenRouter hedge

`SPEECH_PROVIDER=kokoro-openrouter` starts Kokoro (`KOKORO_URL`, optionally
`KOKORO_AUTH=gcp-id-token` for a private Cloud Run service, voice
`INTERVIEWER_VOICE`, default blend `af_bella+af_heart`) and, when it has not
returned audio within `HYBRID_SPEECH_HEDGE_AFTER_MS` or fails, also starts
`OpenRouterSpeechProvider` (voice `OPENROUTER_SPEECH_VOICE`, its own DeepInfra to
Together hedge). The first non-empty audio wins and the other request is
aborted; if both fail the API returns `503 SPEECH_PROVIDER_UNAVAILABLE`.
Startup requires `KOKORO_URL` and `OPENROUTER_API_KEY`. `speech_synthesis_timing`
logs `provider: "hybrid"`, `voiceSource` (`kokoro` or `openrouter`) and `hedge`
(`not_needed`, `primary_won`, `hedge_won`, `both_failed`), never text or tokens.
`GET /api/v1/speech/health` reports `ready` without calling either upstream, so it
does not wake Kokoro.

`POST /api/v1/speech/warmup` (authenticated) wakes a scale-to-zero Kokoro: in hybrid
mode it fires an authenticated `GET {KOKORO_URL}/health` in the background (one in
flight, at most once per 60 s) and returns `202`; other modes return `204`.

`GET /api/v1/speech/warmup-status` (authenticated, never blocks) returns
`{"voice":"ready"|"warming"|"unavailable"}` from cached knowledge in hybrid mode: `ready`
if a Kokoro `/health` or a Kokoro synthesis succeeded in the last 60 s; otherwise it
triggers the same deduped probe (at most one in flight, at most every 5 s from status
polls) and returns `warming`, or `unavailable` for 60 s after a failed probe (non-2xx,
token error, network). A probe cut short by the request timeout counts as still warming.
Other modes always return `ready`. See `docs/deploy.md` for the Cloud Run service.

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

Each `POST /api/v1/speech` synthesis logs one content-free
`speech_synthesis_timing` line with `status` (`ok`, `error`, or `aborted`),
`provider`, `durationMs`, and `textLength`. It never contains the text, voice
settings, or upstream error messages.

## Authentication

Every `/api/v1` route except `GET /api/v1/speech/health` (and `GET /health`) requires the
user's Supabase access token: `Authorization: Bearer <access token>` on HTTP calls. Browsers
cannot set headers on WebSockets, so `/api/v1/transcriptions/stream` takes it in the first
`start` message as `accessToken`; nothing else is processed before an authenticated `start`,
and a socket that has not authenticated within 10 seconds is closed.

Tokens are verified locally with `node:crypto`: ES256 only, signature against the project's
public keys from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached for 10 minutes,
refetched at most once every 30 seconds for an unknown `kid`), then `exp` (30 s skew), `nbf`,
`iss` (`${SUPABASE_URL}/auth/v1`), `aud` (`authenticated`) and `sub`. No Supabase secret is
needed and the token is never logged.

When `SUPABASE_PUBLISHABLE_KEY` is set, tokens the local path cannot verify (any `alg` other than
ES256, for example a project still signing with the legacy HS256 secret, or a `kid` still unknown after
the allowed JWKS refetch) are checked remotely with `GET ${SUPABASE_URL}/auth/v1/user` (headers
`apikey` and `Authorization: Bearer <token>`, 3 s timeout). `alg: none` is always rejected locally.
`exp`, `iss` and `aud` are checked first from the unverified payload, so expired or foreign tokens never
reach Supabase. A 200 with an `id` authenticates; 401/403 is a rejection (`rejected_by_supabase`); any
other status, network error or timeout is a `503 AUTH_UNAVAILABLE`. Successes are cached by
`sha256(token)` until `min(exp, now + 10 min)` (at most 500 entries; the raw token is not stored),
failures are not cached, and identical concurrent tokens share one request. Each remote check logs
only `{"event":"auth_remote_check","outcome":"accepted|rejected|unavailable","trigger":"non_es256|unknown_kid"}`.

A missing or invalid token returns `401 {"error":{"code":"UNAUTHENTICATED","message":"Sua sessão expirou. Entre novamente."}}`
(WebSocket: an `error` message with the same code, then close `1008`); an unreachable key set
returns a generic `503 AUTH_UNAVAILABLE`. Rejections log only
`{"event":"auth_rejected","route"|"channel":...,"reason":...}`. For Docker, add
`SUPABASE_URL=<same as NEXT_PUBLIC_SUPABASE_URL>` to `backend/.env`.

## Current routes

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ "status": "ok" }`. |
| `GET` | `/api/v1/transcriptions/providers` | Returns the configured transcription choices for the local comparison selector. |
| `POST` | `/api/v1/transcriptions` | Receives a completed 16 kHz mono WAV response (maximum 30 seconds), returns a transcription from the selected configured provider. This compatibility route is separate from streaming. Audio is not persisted. |
| `WS` | `/api/v1/transcriptions/stream` | Protocol v2 receives 16 kHz mono signed 16-bit PCM frames plus RMS `level`, then `finalize` or `cancel`. It makes no Whisper requests during capture. On `finalize`, it assembles one WAV directly from in-memory frames and makes one canonical Whisper request with `verbose_json` and both word and segment timestamps. It returns one `complete` message with the canonical transcript. Audio is bounded by 180 seconds/6 MiB per session, up to 8 active sessions, 4 concurrent final Whisper requests, and 4 queued final requests by default. Capacity overflow returns a recoverable error. Audio is cleared on completion, error, cancellation, and disconnect; it is never persisted or logged. Optional Azure assessment runs after `complete`, using timestamp-aligned groups with a 25-second target (never over 30 seconds), and emits one aggregate `assessment` message with safe timing, block counts, and a fixed failure category when unavailable. If no usable alignment can be built, one bounded segment-only timing request (12-second deadline) may follow; no more than 2 recovery calls run concurrently and up to 6 additional calls may wait. A waiting retry is removed if its client disconnects. It cannot replace the canonical transcript, and its audio buffer remains temporary. Missing timing or full recovery capacity preserves the transcript and makes assessment unavailable. |
| `POST` | `/api/v1/thinking` | Assesses technical answer coverage and English communication from a supplied transcript. Uses OpenRouter credentials held by the backend. |
| `POST` | `/api/v1/thinking/job-direction` | Analyzes an authenticated user's pasted job description and returns a strict, editable direction (target role, suggested seniority, main interview emphasis, 1–5 priority competencies, and concise product/team context). The description must be 120–20,000 characters and contain enough distinct words. One request per verified user may run at a time, followed by a five-second cooldown in each backend instance; limited calls return `429 JOB_DIRECTION_RATE_LIMITED` with `Retry-After`. Raw description content is sent to the configured OpenRouter model for analysis, but is not logged or persisted by this app. This setup endpoint never generates interview questions. |
| `POST` | `/api/v1/thinking/next-turn` | Prefers one useful, transcript-grounded follow-up when the answer supports it, otherwise chooses a role/focus-adapted main question. The server validates transcript anchors, question bounds, low-information transcripts, and repeated questions. The request may include optional `previousAnswers` (up to the last eight earlier `{question, answer}` pairs; question up to 500 characters and answer up to 300) as prior context only: the model uses it to avoid re-asking answered topics, while the follow-up anchor must still appear literally in the current transcript. Relevance is checked by requiring the follow-up to share a meaningful content word (simple normalization and stemming) with the anchor or the words around it in the same sentence; a single-word anchor copied into an otherwise unrelated question is rejected. Anchors may have 1–12 words (up to 140 characters); a single-word anchor may be a capitalized term or a lowercase meaningful technical term (for example `kafka`), never an article, pronoun, filler, number, or noise. The anchor is matched against the transcript as a normalized word sequence, ignoring case, punctuation, hyphens, quote style, and whitespace. When a FOLLOW_UP is rejected for an anchor or question-shape reason and at least 1.5 s of the overall deadline remains, the service makes one corrective model call (a fixed note naming the problem in plain words, never echoing content); if it fails or there is no time, the fixed NEXT question is used. The `interview_orchestration_decision` log adds `corrective` (`not_needed`, `recovered`, `failed`, `skipped_no_time`) and, when recovered, `recoveredFrom` with the first rejection reason; `reason` keeps the first rejection reason on a failed correction. The frontend only checks response shape and the deterministic fallback; this service is the single source of semantic validation. Run the opt-in live quality eval with `npm run eval:followup` (needs `OPENROUTER_API_KEY`; prints aggregate JSON only, `FOLLOWUP_EVAL_RUNS`, `FOLLOWUP_EVAL_COST_CAP_USD` default `0.2`, and `FOLLOWUP_EVAL_PRINT_ACCEPTED=true` for local review of accepted questions). A brief bridge is optional and never quotes the transcript. Provider errors use a neutral transition and the first supplied fixed question that does not repeat covered context; if none remains, the room closes. |
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
English patterns are limited to errors that affect meaning or credibility (no valid
jargon, synonyms, punctuation or fillers), use type definitions, and may be fewer or
none; the same rules apply to the per-answer analysis.
The backend does not fetch or persist sessions and does not authorize an
interview ID; the authenticated frontend persists results through Supabase RLS.
Provider/configuration errors use the standardized thinking error object.

#### Incremental report (per-answer analysis)

To avoid a 30+ second wait at the end, the frontend analyzes each answer in the
background and only consolidates at the end. Both routes use the report model,
the same prompt rules, schema fragments and evidence validation as the full
report, and the same privacy routing (`data_collection: "deny"`).

- `POST /api/v1/thinking/report/turn` takes `{ roleContext, turn }` (one
  `sequenceNumber`/`question`/`answer`, same limits and strictness; interview IDs
  are rejected) and returns `{ sequenceNumber, technicalStrengths, technicalGaps,
  englishPatterns, model }` with at most 3/3/4 server-validated items. Deadline:
  20 seconds.
- `POST /api/v1/thinking/report/consolidate` takes `{ roleContext, turns,
  turnAnalyses }` with exactly one analysis per turn. The server never trusts the
  client: every item is validated again against its matching answer, English
  patterns are deduplicated across turns, and the usual caps apply (8 strengths,
  8 gaps, 8 patterns, 3 priorities). One small structured call then produces only
  the summary, overall clarity, and up to three priorities that must build on a
  validated finding. The response has the exact full-report shape (`model`,
  `analysisVersion: "v2"`, `evidenceReview`), so persistence and UI are unchanged.
  `evidenceReview` counts the items submitted for consolidation (turn-stage
  rejections are visible only in the benchmark). Deadline: 25 seconds.

Both routes log the content-free `interview_report_phase_timing` event with an
extra `scope` field (`turn` or `consolidate`); the full report keeps its original
shape. Errors use the standardized thinking error object. The frontend falls back
to `POST /report` when any analysis or the consolidation fails.

### Compare report models (opt-in benchmark)

`npm run benchmark:report-models` is not part of `npm test`. It needs
`OPENROUTER_API_KEY` and `REPORT_BENCHMARK_MODELS` (comma-separated OpenRouter
model ids). It runs each synthetic report fixture once per model through the real
report service and validator, then prints only aggregate JSON per model: success
and failure counts by fixed category, median/p90 latency, total and mean
provider-reported cost, and summed evidence accepted/rejected counts by reason.
It never prints fixture text, model output, or credentials. The run aborts when
cumulative cost exceeds `REPORT_BENCHMARK_MAX_USD` (default `0.50`).
`REPORT_BENCHMARK_MODE=incremental` instead compares, per fixture, the single full
report with the incremental path (per-turn calls in parallel, then consolidation),
reporting the consolidation-only latency (the end-of-interview wait), cost per
report both ways, and evidence accepted/rejected both ways.

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

To compare providers the way the browser behaves, add `--server-finalize` (or
`AUDIO_E2E_SERVER_FINALIZE=true`): the client does not send `finalize` on
`silence-detected`; it keeps streaming 100 ms silence frames (up to 15 s) until
the server sends `finalizing`/`complete`, and reports `speechEndToCompleteMs`
(end of the synthetic speech to `complete`). Output stays content-free.

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
through the configured Whisper provider (a 429 or one transient 5xx/network failure can trigger up to two bounded
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

`OPENROUTER_API_KEY` enables Whisper Large V3 Turbo for the streaming response path. The browser captures mono PCM at 16 kHz through AudioWorklet and sends 100 ms s16le frames over WebSocket protocol v2. Frames are retained only in backend memory. After the candidate ends the answer, the backend creates one WAV directly from those frames and sends it as multipart audio, avoiding Base64 expansion. No partial transcript is produced. The process accepts up to eight active recordings, runs at most four final Whisper calls concurrently, and queues up to four finalized responses. Queue saturation fails clearly and allows the candidate to retry. OpenRouter has a 55-second overall request budget by default (`TRANSCRIPTION_TIMEOUT_MS`); an HTTP 429 may be retried up to twice within that budget with bounded `Retry-After` handling, and one HTTP 5xx or network error is retried once after a 500 ms backoff. All retries share the same budget and a cap of three HTTP attempts per transcription; a timeout of the budget or an aborted caller (cancel, discarded speculation, disconnect) is never retried. Failures carry a fixed content-free category (`providerStatus`: `5xx`, `429`, `rejected`, `timeout`, `network`, `aborted`, `invalid_response`, `empty`) and the attempt count, which the `failed` stream diagnostic logs; the `complete` diagnostic adds `attempts` only when a retry happened. The primary request asks for both word and segment timings. If neither produces a usable, transcript-aligned Azure block, a single segment-only recovery request may run with a 12-second active provider deadline outside the scarce final-transcription queue slot. Recovery has its own cap of two active calls and six waiting calls; a disconnected waiting session is removed from the queue. It uses the same temporary WAV and the same Whisper model; Azure reference text is always taken from the canonical primary transcript, and only exact matching timestamped phrases are assessed. This can add a second audio-transcription charge only on fallback cases. The 12-second limit applies to the active provider request; bounded recovery-queue wait may add latency to the optional Azure result. Neither recovery nor queue wait delays the already-sent transcript or next interview turn. VAD signals after 3.5 seconds of confident trailing silence, then keeps receiving audio for a reversible 1.5-second server-side grace plus the 300 ms activity-confirmation interval. Confirmed resumed activity cancels that handoff; otherwise the response is finalized in about 5.3 seconds from silence onset. When VAD reports confident `silence` and a final-transcription slot is free right now, the backend speculatively starts Whisper on an in-memory snapshot of the audio so far (never queued, never above the concurrency limit; without a free slot it falls back to the normal path). Confirmed resumed activity aborts the speculative request, zeroes the snapshot and frees the slot; otherwise `finalize` reuses the same call, so `complete` is still sent only after the grace ends and no partial transcript is produced. If the speculative call fails, one normal final transcription runs instead. Azure uses the snapshot's timings against the full final audio (the extra tail is trailing silence). `ambient_activity` and manual finalization never speculate. The `complete` diagnostic adds a content-free `speculation` field (`reused`, `discarded`, `skipped_no_slot`, `failed` or `none`). Ambiguous sustained mid-band activity gets an 8-second bounded grace period, then finalizes with an `ambient_activity` reason so changing room noise cannot hold capture open indefinitely. Calibration uses the least active initial frame, falls back to a conservative voice threshold if every calibration frame is elevated, and caps the calibrated threshold at 0.05. The interface has no manual answer-finalization control. Audio continues accumulating in memory until automatic finalization, preserving the full response and pauses. The backend clears audio buffers on success, error, cancellation, and disconnect; audio is not persisted or logged and provider keys remain server-side. Operational diagnostics contain only a coarse calibration band, finalization reason, and timing metadata. The legacy WAV route remains available for compatibility and keeps its own 30-second limit.

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
removes the anchor from the public response. `NEXT` requires a null anchor. The
decision call only decides and writes the question; its own optional
acknowledgement stays a short neutral phrase and is used only as a fallback.
Noise-only answers skip the provider call. At most one follow-up is accepted per
planned question; timeout, rate limiting, provider errors, missing credentials,
or malformed output use the first remaining fixed question that is not
repetitive, or close the room when no safe planned question remains.

Bridge step (ENG-105): after a valid decision is chosen (including the
deterministic fallback `NEXT`), a second, separate call
(`interview-bridge-service.ts`) writes one spoken bridge said right before the
question. It uses `INTERVIEW_REASONING_MODEL`, temperature 0.2, a strict
`{"bridge": string|null}` schema and the same provider routing (latency sort,
required parameters, no data collection). Its input is the decision, current
question, transcript, the chosen question, a deterministic `bridgeLeadIn`
(rotating, avoiding the first two words of the last three
`recentAcknowledgements`) and role context. The bridge restates what the
candidate did using only transcript facts; for `FOLLOW_UP` it is one sentence of
at most 16 words (110 characters), for `NEXT` a restating sentence of at most 18
words plus an optional short transition (at most 14 words), 30 words in total. It is validated
deterministically and an invalid bridge only drops the bridge, never the
question: praise or evaluation and inferred feelings, a question mark, extra
sentences, invented details (every non-glue content word must come from the
transcript, one paraphrase word tolerated when at least two overlap and two when at least three overlap, and a
new capitalized name or number never), copying more than eight consecutive
transcript words, an exact repeat of `recentAcknowledgements`, and a question
that adds no new content word. For `NEXT`, if the question shares two or more
content words with the restating sentence, only the transition sentence is
dropped. Outcome: `FOLLOW_UP` uses a valid bridge instead of the decision's own
acknowledgement, otherwise keeps that acknowledgement (or null); `NEXT` uses a
valid bridge, otherwise a deterministic neutral transition that rotates and
avoids recent acknowledgements, and null when no question is left.
Low-information transcripts skip the call (`NEXT` gets a neutral transition).
The call has its own timeout (`INTERVIEW_BRIDGE_TIMEOUT_MS`, default 1800 ms),
is capped by what remains of the overall next-turn deadline, and is skipped when
less than 1200 ms remain, so the 6-second budget still holds. Every orchestration decision emits one
content-free `interview_orchestration_decision` log line with the accepted
decision or deterministic fallback, any valid model decision that was rejected,
a fixed reason category, `followUpUsed`, and latency (the decision call only).
The same line carries the bridge summary: `bridge` (`grounded`, `neutral`,
`none` or `dropped`), `bridgeOutcome` (`generated`, `dropped`, `timeout`,
`error`, `skipped_no_time`, `skipped_low_info`), a fixed `bridgeDropReason`
(`invalid_text`, `too_long`, `evaluative`, `repeated_recent`,
`not_one_sentence`, `not_grounded`, `invented_detail`, `copies_transcript`,
`redundant_with_question`), `bridgeLatencyMs`, `leadInFollowed` (grounded only)
and `transitionDropped` (only when true), never the bridge text. It never contains a
question, transcript, anchor, acknowledgement, model name, session identifier,
credential, or raw provider response. Model, latency, provider-reported cost,
and the separate `interview_orchestration_fallback` warning can be enabled with
the server-only `INTERVIEW_REASONING_DIAGNOSTICS=true` flag; it defaults off.
Provider-reported cost (decision plus bridge) and model details are returned only
when this flag is enabled. The opt-in `npm run eval:followup` reports bridge
rates (overall and by decision), the bridge outcome and drop-reason histograms,
lead-in variety and an interview-sequence pass that feeds accepted bridges back
as `recentAcknowledgements`; with `FOLLOWUP_EVAL_PRINT_ACCEPTED=true` it prints
the accepted bridges locally. Orchestration
uses a separate 6-second timeout by default; answer assessment retains its
15-second timeout. The browser cancels orchestration requests after 7 seconds
so its fallback stays slightly outside the backend timeout.
Within that single deadline the service retries once after a fast network
error, HTTP 5xx, or 429 when at least 2 seconds remain, and hedges a slow
request as described above; an invalid (rejected) response never wins while
another call is still pending. Once the follow-up is used, the structured-output
schema only allows `NEXT` (with null `followUpQuestion` and `anchor`) so the model
writes an adapted main question; parser rules are unchanged. The decision log
also carries `attempts` (provider calls made) and `hedge` (`not_needed`,
`primary_won`, `secondary_won`, `retried`, or `failed`).

Set `AZURE_SPEECH_ASSESSMENT_ENABLED=true` to assess the final answer using timestamps from the canonical Whisper transcript. The primary Whisper request asks OpenRouter for `verbose_json` and both word- and segment-level timestamps. When word timings are usable, the backend groups adjacent words deterministically into audio slices targeted at 25 seconds each, preserving pauses inside a group. When word timing is missing or cannot produce a safe block, usable segment timings are considered. If there is still no transcript-aligned block, one bounded segment-only recovery request may run; its timing is accepted only for phrases that match in order against the canonical transcript, and untimed gaps are not bridged. Each Azure scripted `ReferenceText` contains only canonical words aligned to its matching slice. At most two Azure requests run concurrently. Scores are duration-weighted across successful slices; any successful score dimensions are returned in one `available` assessment with `segmented: true`, and total Azure failure or unusable timing returns `unavailable`. Assessment and timing recovery start after the `complete` transcript event, so they never delay or replace the transcript. Per-answer diagnostics report only durations, timing source/recovery outcome, accepted versus received timestamp counts, queue/provider timings, block counts, and fixed failure categories; they never include audio, transcript, score values, or credentials. Disabled configuration is logged as a fixed reason (`disabled_by_config`, `missing_key`, or `missing_region`). The frontend allows up to 10 seconds for pending assessments when the report begins and applies later results to the visible and persisted summary. The assessment is experimental and may inherit recognition errors from Whisper. These signals are not an English-level, readiness, proficiency, or accent measure. Microsoft's pricing material lists some pronunciation-assessment enhanced features under Standard/pay-as-you-go and Prosody as an additional paid score, so verify current pricing and tier terms for the target resource; this implementation does not assume S0 is required. Keep the toggle off when these costs are not desired. See Microsoft's [Pronunciation Assessment guide](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment), [short-audio REST format limits](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short), and [pricing guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool).

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.

### Answer transcription (incremental Whisper)

Whisper is the only answer-transcription engine. The browser streams PCM over `/api/v1/transcriptions/stream`; the backend buffers it in memory and the local VAD drives everything. At each pause (`TRANSCRIPTION_PAUSE_MS`) the pending audio is cut into a segment, wrapped in a WAV and transcribed in the background with OpenRouter `whisper-large-v3-turbo` (existing retry/backoff, 8 s limit per segment), so the transcript is almost ready when the candidate stops talking. Text is committed in segment order even if calls finish out of order; a segment's turn end is signalled only after all earlier segments are committed and only if no speech resumed since the cut (otherwise its text still joins the transcript). Segments with under about 300 ms of VAD speech are not transcribed; Whisper's known hallucinations on near-silence (`you`, `Thank you.`, `thanks for watching`, `bye`, `the end`) are dropped when the segment had under 1.2 s of speech. Continuous speech is force-cut about every 15 s at the quietest of the last 3 s of level frames, so the tail after the end stays short. The previous text is not sent as Whisper `prompt` because the OpenRouter transcription service does not support it.

After a turn end a grace timer starts (`TRANSCRIPTION_ANSWER_GRACE_MS` for a complete-looking sentence, `TRANSCRIPTION_INCOMPLETE_GRACE_MS` for an unfinished-looking one), counted from when the pause was detected, not from when the segment text returns, so Whisper latency overlaps the wait. Resumed local VAD speech cancels it. When it fires the backend sends `finalizing`, awaits in-flight segments (bounded, 8 s), transcribes the tail if it holds speech and sends `complete` with the ordered concatenation and `provider: "whisper-incremental"`. If any segment fails or times out, or the transcript is empty, that answer uses the full-audio Whisper path (speculation, hedge, retries), so correctness never depends on segmentation. That full-audio path is also the whole path when the server is attached without streaming options (tests). Azure assessment is unchanged: Whisper runs in the background after `complete` for word timings.

The current frontend no longer sends `captions` (candidate live captions were removed from the UI); the flag stays optional on the wire. If the `start` message includes `captions: true`, the browser also receives live display captions `{ "type": "caption", "committed": string, "partial": "" }` (`committed` = ordered segment texts so far, `partial` always empty). Captions are throttled to about 5 messages per second, sent only when the text changed, never on the full-audio path, without the flag, or after `finalizing`, and are never logged. They are display-only: the canonical transcript for follow-ups, the report and persistence is the final `complete` transcript.

The `complete` diagnostic (`transcription_stream`, `status: "complete"`) carries `requestedEngine`, `resolvedMode` (`whisper-incremental`, or `whisper` on the full-audio path), `provider`, `incrementalTurns`, `segmentsTranscribed`, `segmentsSkipped`, `tailMs` (audio length of the tail cut at the end), `maxSegmentLatencyMs`, `preparesSent`, `answerEndReason` (`turn_end_grace`, `semantic_complete`, `vad_silence`, `fallback_whisper`), the semantic fields below and `speechEndToCompleteMs`, never text. A failed segment logs `incremental_whisper_unavailable` with reason `segment_failed`. Cost is Whisper only (about US$0.01 per audio hour), plus a little for the pause overhead and silence cuts that are skipped.

#### Legacy engine selection

The `start` message may still carry `transcriptionEngine` (`"whisper"`, or `"ink-2"` / `"cartesia"` from frontends that predate the removal of the second engine). Every accepted value resolves to incremental Whisper and is only logged as `requestedEngine`; any other value is ignored with a content-free `invalid_message` log (field `start.transcriptionEngine`). A `keyterms` field in `start` is ignored.

#### Provisional answers (next-turn preparation)

During continuous speech, the first provisional snapshot is sent after about 6 seconds of finalized audio. Another is sent only after at least 6 additional seconds of audio have been finalized, and at most two revisions are spent during continuous speech so one remains available for a pause that may end the answer. After a turn end, `TRANSCRIPTION_PREPARE_AFTER_MS` (default 1200 ms) sends `{ "type": "answer-provisional", "transcript": string, "revision": number }` during the grace, provided the grace is longer than this delay. `transcript` is the current concatenation of committed segments (what `complete` would carry if nothing else is said) and `revision` increments per message in the answer (at most `TRANSCRIPTION_MAX_PREPARES`, default 3, and identical text is not resent). Resumed VAD speech or finalizing cancels a pending pause-triggered message and nothing is sent after `finalizing`. It is sent regardless of the captions flag, is never logged, and is only a hint: the browser may start deciding and synthesizing the next question, but the canonical transcript is still `complete`. The `complete` diagnostic adds `preparesSent` (a count, never text). It also runs as soon as the segment text arrives if its delay has already elapsed since the pause.

#### Semantic end of answer

The `start` message may include `question` (the current interviewer question; control characters become spaces, empty or over 400 characters is ignored; never logged, echoed or persisted). At the same trigger as `answer-provisional` (`TRANSCRIPTION_PREPARE_AFTER_MS` after a turn end with no resumed speech, at most `TRANSCRIPTION_MAX_SEMANTIC_CHECKS` checks per answer, same cancel rules) and only when a question is known, the backend makes one OpenRouter call to `INTERVIEW_REASONING_MODEL` (strict JSON `{ "complete": boolean }`, temperature 0, `provider: { sort: "latency", require_parameters: true, data_collection: "deny" }`, timeout `TRANSCRIPTION_SEMANTIC_END_TIMEOUT_MS`). The prompt is conservative: `complete: true` only for a substantive answer that ends at a natural conclusion; list openings, trailing connectors, promises of more and a short sentence that does not yet address the question are `false`; when unsure, `false`. If the verdict is `true` and no resumed VAD speech or finalization happened meanwhile, the answer ends immediately with `answerEndReason: "semantic_complete"` instead of waiting for the rest of the grace. `false`, an error or a timeout change nothing: the grace keeps running. The call is aborted on resumed speech, finalize, cancel and close. The `complete` diagnostic adds `semanticChecks`, `semanticVerdict` (`complete`, `incomplete`, `timeout`, `error`, `none`) and `semanticLatencyMs`, never text.
