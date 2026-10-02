# Production deploy (ENG-101)

Frontend on Vercel, backend on Google Cloud Run. Commands below contain names
only, never values. Run them from the repository root.

## Architecture

- **Frontend**: Next.js app in `frontend/`, deployed on Vercel. Talks to
  Supabase (auth + persistence) and to the backend (HTTP + WebSocket).
- **Backend**: Express + ws container built from `backend/Dockerfile.production`
  and run on Cloud Run in `us-east1` (project `english-interview-agent-510312`).
  Request-based billing, min 0 / max 1 instance, 1 vCPU, 1 GiB, session affinity.
  The image includes `ffmpeg` (required for Azure pronunciation assessment).
- **Providers** (all called from the backend only): OpenRouter (interviewer voice
  with Kokoro, reasoning, report, Whisper fallback), Cartesia (streaming STT),
  Azure Speech (pronunciation assessment).
- Local development is unchanged: `compose.yaml` uses `backend/Dockerfile` with
  `npm run dev`.

## Backend environment

Secrets (Secret Manager): `OPENROUTER_API_KEY`, `AZURE_SPEECH_KEY`,
`CARTESIA_API_KEY`.

Plain variables: `SPEECH_PROVIDER=openrouter`, `TRANSCRIPTION_PROVIDER=cartesia`,
`AZURE_SPEECH_REGION`, `AZURE_SPEECH_ASSESSMENT_ENABLED=true`,
`SUPABASE_URL` (the public project URL, same as `NEXT_PUBLIC_SUPABASE_URL`; the
backend refuses to start without it while `BACKEND_AUTH_REQUIRED` is unset or
`true`), `SUPABASE_PUBLISHABLE_KEY` (public, recommended; same value as
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; enables the remote token check for non-ES256 signing
keys), `ALLOWED_ORIGIN=https://englishinterview.vercel.app,https://english-interview-agent.vercel.app` (no trailing slash).

To use the self-hosted Kokoro service below as the primary interviewer voice
(OpenRouter becomes the hedge), set `SPEECH_PROVIDER=kokoro-openrouter`,
`KOKORO_URL=<kokoro service url>` and `KOKORO_AUTH=gcp-id-token` instead of
`SPEECH_PROVIDER=openrouter`. `OPENROUTER_API_KEY` stays required.

Do not set `KOKORO_BASE_URL` or
`INTERVIEW_REASONING_DIAGNOSTICS`. Cloud Run injects `PORT=8080`. Every other
variable keeps its default; see the table in `backend/README.md`.

## One-time setup

```bash
PROJECT=english-interview-agent-510312
REGION=us-east1
gcloud config set project $PROJECT

# APIs (already enabled for this project)
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Docker repository
gcloud artifacts repositories create english-interview --repository-format=docker \
  --location=$REGION

# Secrets, read from the ignored backend/.env without printing values
for NAME in OPENROUTER_API_KEY AZURE_SPEECH_KEY CARTESIA_API_KEY; do
  grep "^$NAME=" backend/.env | cut -d= -f2- | tr -d '\n' \
    | gcloud secrets create $NAME --data-file=-
done

# Let the Cloud Run runtime service account read them
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for NAME in OPENROUTER_API_KEY AZURE_SPEECH_KEY CARTESIA_API_KEY; do
  gcloud secrets add-iam-policy-binding $NAME \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done
```

To rotate a secret, add a version (`... | gcloud secrets versions add NAME --data-file=-`);
the service uses `:latest`, so create a new revision afterwards (see Update).

## Build and deploy the backend

`gcloud run deploy --source` does not use `Dockerfile.production`, so build with
Cloud Build and deploy the image. `backend/.gcloudignore` keeps `.env`,
`node_modules` and tests out of the upload; check it with
`gcloud meta list-files-for-upload backend`.

```bash
TAG=$(git rev-parse --short HEAD)
IMAGE=$REGION-docker.pkg.dev/$PROJECT/english-interview/backend:$TAG

gcloud builds submit backend --config backend/cloudbuild.production.yaml \
  --substitutions=_IMAGE=$IMAGE

gcloud run deploy english-interview-backend \
  --image $IMAGE --region $REGION \
  --allow-unauthenticated \
  --max-instances 1 --min-instances 0 --cpu 1 --memory 1Gi \
  --concurrency 20 --timeout 3600 --session-affinity \
  --set-env-vars "SPEECH_PROVIDER=openrouter,TRANSCRIPTION_PROVIDER=cartesia,AZURE_SPEECH_REGION=<region>,AZURE_SPEECH_ASSESSMENT_ENABLED=true,SUPABASE_URL=<supabase-url>,SUPABASE_PUBLISHABLE_KEY=<publishable-key>,ALLOWED_ORIGIN=<vercel-origin>" \
  --set-secrets "OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,AZURE_SPEECH_KEY=AZURE_SPEECH_KEY:latest,CARTESIA_API_KEY=CARTESIA_API_KEY:latest"
```

`--allow-unauthenticated` is required because browsers call the service
directly; every `/api/v1` route that spends providers and the transcription
WebSocket require a Supabase access token (ENG-102, see `backend/README.md`
"Authentication"). The deploy
prints the service URL (`https://english-interview-backend-<hash>-ue.a.run.app`).
Check it: `curl <url>/health` returns `{"status":"ok"}`.

The WebSocket route is `wss://<service-url>/api/v1/transcriptions/stream`. One
answer lasts up to 180 s, well inside the 3600 s request timeout.

## Frontend on Vercel

The GitHub repository belongs to another account, so the Vercel GitHub app
cannot import it. The frontend is deployed with the Vercel CLI from `frontend/`
(`frontend/.vercelignore` keeps `.env*`, `node_modules` and `.next` out of the
upload).

- Project: `english-interview-agent` (Root Directory `.` because the CLI runs
  inside `frontend/`). Production domain: `https://englishinterview.vercel.app`
  (also `https://english-interview-agent.vercel.app`).
- Environment variables (Production): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_BACKEND_URL` (the Cloud
  Run service URL, no trailing slash). The frontend converts `https://` to
  `wss://` for the stream. Add values without echoing them, for example
  `grep '^NAME=' .env.local | cut -d= -f2- | tr -d '\n' | vercel env add NAME production`.
- Deploy (after every merge that changes the frontend):

  ```bash
  cd frontend
  vercel link --yes --project english-interview-agent   # once per checkout
  vercel deploy --prod --yes
  ```

- The backend allows the production origins:

  ```bash
  gcloud run services update english-interview-backend --region $REGION \
    --update-env-vars "^@^ALLOWED_ORIGIN=https://englishinterview.vercel.app,https://english-interview-agent.vercel.app"
  ```

  The `^@^` prefix changes gcloud's list delimiter so the comma stays inside the
  value.

`NEXT_PUBLIC_*` values are inlined at build time; redeploy the frontend after
changing them.

## Supabase

In Authentication, URL Configuration: set **Site URL** to the Vercel production
origin and add `<vercel-origin>/**` to **Redirect URLs** (keep the localhost
entries for development).

## Update, rollback, logs

```bash
# New version: repeat the build (new TAG) and `gcloud run deploy` above.

# Rollback
gcloud run revisions list --service english-interview-backend --region $REGION
gcloud run services update-traffic english-interview-backend --region $REGION \
  --to-revisions <revision>=100

# Logs
gcloud run services logs read english-interview-backend --region $REGION --limit 100
```

Logs never include audio, transcripts or keys by design; keep it that way.

## Cost guardrails and cold starts

- `--max-instances 1` caps compute and concurrent sessions; `--min-instances 0`
  means no idle cost. A budget alert exists on the project.
- With one instance, `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` (default 8) and
  `--concurrency 20` bound parallel users; overflow gets a recoverable error.
- Cold start: expect about 1 to 3 s on the first request after idle. Open the
  app a few seconds before the first answer, or set `--min-instances 1` for
  demos (adds idle cost).
- In-memory audio and sessions are lost when the instance restarts; an answer in
  progress at that moment must be retried.

## Launch blockers

- **No per-user usage limits**: any signed-up user can spend provider credits;
  limits were deferred while usage is small.
- **Cartesia credits and data retention**: confirm the credit balance covers
  expected usage and review Cartesia's retention terms before real users send
  audio.

## Verified locally vs. only documented

Verified locally: `npm run build`, `node dist/server.js` health check, and the
production image build and `/health` check with Docker. First production deploy
(2026-10-01): Cloud Build image, Cloud Run revision in `us-east1`, `/health`
200, speech through OpenRouter 200 in about 0.9 s, WebSocket `ready` from the
production origin and refused (503) from other origins, Vercel production
deploy on `englishinterview.vercel.app`. Supabase URL configuration is done in
the Supabase dashboard.

## Kokoro voice service (private)

A self-hosted Kokoro runs as a private Cloud Run service and is the primary
interviewer voice when the backend uses `SPEECH_PROVIDER=kokoro-openrouter`.

```bash
# Mirror the public image once (Cloud Run cannot pull from ghcr.io directly).
docker pull --platform linux/amd64 ghcr.io/remsky/kokoro-fastapi-cpu:v0.6.0
docker tag ghcr.io/remsky/kokoro-fastapi-cpu:v0.6.0 $REGION-docker.pkg.dev/$PROJECT/english-interview/kokoro:v0.6.0
docker push $REGION-docker.pkg.dev/$PROJECT/english-interview/kokoro:v0.6.0

gcloud run deploy english-interview-kokoro \
  --image $REGION-docker.pkg.dev/$PROJECT/english-interview/kokoro:v0.6.0 --region $REGION \
  --no-allow-unauthenticated \
  --cpu 4 --memory 8Gi --cpu-boost \
  --min-instances 0 --max-instances 1 --concurrency 4 \
  --set-env-vars "OMP_NUM_THREADS=4,MKL_NUM_THREADS=4,TORCH_NUM_THREADS=4"

# Only the backend's service account may call it (default compute SA unless changed).
gcloud run services add-iam-policy-binding english-interview-kokoro --region $REGION \
  --member "serviceAccount:<backend-service-account>" --role roles/run.invoker
```

Then deploy the backend with `SPEECH_PROVIDER=kokoro-openrouter`,
`KOKORO_URL=<english-interview-kokoro url>` and `KOKORO_AUTH=gcp-id-token`.
The backend fetches an identity token from the metadata server (audience = the
Kokoro URL origin) and sends it as `Authorization: Bearer`. Without it Kokoro
answers 403.

Measured warm latency on 4 vCPU: about 1.2-1.5 s for 24 characters, 1.7-1.8 s
for 50, 4.3 s for 106. With min instances 0 the first request after idle pays a
cold start, so the frontend calls `POST /api/v1/speech/warmup` when the setup
screen and the interview room open; the backend then pings Kokoro `/health`
(at most once per 60 s). If Kokoro has not produced audio after
`HYBRID_SPEECH_HEDGE_AFTER_MS` (2500 ms) or fails, OpenRouter races it and the
first audio wins.
