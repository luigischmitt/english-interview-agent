# Backend

The backend provides interviewer speech through Kokoro, completed-response transcription through OpenRouter Whisper Large V3 Turbo, and a technical-answer/English-communication assessment through OpenRouter. The English-formulation route remains a placeholder.

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
| `OPENROUTER_API_KEY` | — | OpenRouter key. Enables the two Whisper transcription choices and stays server-side. |
| `INTERVIEW_REASONING_MODEL` | `mistralai/mistral-small-3.2-24b-instruct` | OpenRouter model for the `thinking` route. Keep this configuration server-side. |
| `INTERVIEW_REASONING_TIMEOUT_MS` | `15000` | Positive timeout in milliseconds for interview-answer reasoning requests. |

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
| `POST` | `/api/v1/transcriptions` | Receives a completed 16 kHz mono WAV response (maximum 30 seconds), returns a transcription from the selected configured provider. Audio is not persisted. |
| `WS` | `/api/v1/transcriptions/stream` | Receives `start`, RMS `level`, binary audio, and `finalize` or `cancel` messages. Keeps up to 30 seconds / 4 MiB in memory and calls Whisper Turbo once on completion. |
| `POST` | `/api/v1/thinking` | Assesses technical answer coverage and written English communication. Uses OpenRouter credentials held by the backend. |
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

### Configure Azure Speech locally

Create `backend/.env` locally (it is ignored by Git):

```bash
AZURE_SPEECH_KEY=<your-resource-key>
AZURE_SPEECH_REGION=brazilsouth
OPENROUTER_API_KEY=<your-openrouter-key>
```

`OPENROUTER_API_KEY` enables Whisper Large V3 Turbo for the streaming response path. The browser sends WebM or MP4 chunks and VAD levels over WebSocket; silence after 1.5 seconds or the manual finish button triggers a single transcription call. The backend does not persist audio or expose the provider key. The legacy WAV route remains available for compatibility.

The same server-side key enables `/api/v1/thinking`. Override the reasoning
model or timeout locally with `INTERVIEW_REASONING_MODEL` and
`INTERVIEW_REASONING_TIMEOUT_MS`; these variables must not be exposed to the
browser. The selected default is a stable Mistral Small 3.2 model, and the
reasoning request has a 15-second default timeout. Its provider routing
requires structured-output support and denies data collection.

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.
