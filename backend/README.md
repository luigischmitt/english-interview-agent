# Backend

The backend provides interviewer speech through Kokoro and completed-response transcription through Azure Speech. Reasoning and English-formulation routes remain placeholders.

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
| `POST` | `/api/v1/transcriptions` | Receives a completed 16 kHz mono WAV response (maximum 30 seconds), returns Azure Speech transcription and pronunciation signals. Audio is not persisted. |
| `POST` | `/api/v1/thinking` | Reserved for interview-context reasoning; returns `501` until connected. |
| `POST` | `/api/v1/formulations` | Reserved for answer formulation in English; returns `501` until connected. |
| `GET` | `/api/v1/speech/health` | Reports whether the configured speech provider is ready. |
| `GET` | `/api/v1/speech/voices` | Returns the sole approved interviewer persona. |
| `POST` | `/api/v1/speech` | Generates MP3 audio for interviewer text. |

All API errors use `{ "error": { "code": string, "message": string } }`.

### Configure Azure Speech locally

Create `backend/.env` locally (it is ignored by Git):

```bash
AZURE_SPEECH_KEY=<your-resource-key>
AZURE_SPEECH_REGION=brazilsouth
```

The browser converts a completed response to 16 kHz mono WAV before sending it to this backend route. The backend does not store audio or expose the Azure key; it forwards the WAV body to Azure Speech for transcription. This first implementation accepts responses up to 30 seconds and does not stream audio over WebSocket.

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.
