# Backend

Initial HTTP structure for the English Interview Agent. Transcription, reasoning, and English-formulation providers are still placeholders. Speech synthesis is available through a provider boundary and can call a local Kokoro container.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The server runs on `http://localhost:3001` by default.

## Run Kokoro locally

From the repository root, start Kokoro in the background:

```bash
docker compose up -d
```

Set the following in `backend/.env` to use it:

```dotenv
SPEECH_PROVIDER=kokoro
KOKORO_BASE_URL=http://localhost:8880
INTERVIEWER_VOICE=af_bella+af_heart
```

The Compose service uses the CPU image and restarts automatically when Docker starts. Stop it with:

```bash
docker compose down
```

When `SPEECH_PROVIDER=fake` (the default), the API returns deterministic test audio and never requires Docker or Kokoro.

## Current routes

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ "status": "ok" }`. |
| `POST` | `/api/v1/transcriptions` | Reserved for audio transcription; returns `501` until connected. |
| `POST` | `/api/v1/thinking` | Reserved for interview-context reasoning; returns `501` until connected. |
| `POST` | `/api/v1/formulations` | Reserved for answer formulation in English; returns `501` until connected. |
| `GET` | `/api/v1/speech/health` | Reports whether the configured speech provider is ready. |
| `GET` | `/api/v1/speech/voices` | Returns the sole approved interviewer persona. |
| `POST` | `/api/v1/speech` | Generates MP3 audio for interviewer text. |

All API errors use `{ "error": { "code": string, "message": string } }`.

### Generate interviewer speech

```bash
curl -X POST http://localhost:3001/api/v1/speech \
  -H 'Content-Type: application/json' \
  -d '{"text":"Tell me about yourself.","speed":1}' \
  --output interviewer.mp3
```

The client supplies only `text` and optional `speed` (`0.25` through `4`). The server owns the voice selection and always passes `af_bella+af_heart` to Kokoro.
