# Backend

Initial HTTP structure for the English Interview Agent. This issue intentionally does not connect transcription, reasoning, or English-formulation providers.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The server runs on `http://localhost:3001` by default.

## Current routes

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/health` | Returns `{ "status": "ok" }`. |
| `POST` | `/api/v1/transcriptions` | Reserved for audio transcription; returns `501` until connected. |
| `POST` | `/api/v1/thinking` | Reserved for interview-context reasoning; returns `501` until connected. |
| `POST` | `/api/v1/formulations` | Reserved for answer formulation in English; returns `501` until connected. |

All API errors use `{ "error": { "code": string, "message": string } }`.
