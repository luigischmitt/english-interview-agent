/**
 * Pre-generates the audio of every fixed Treinar phrase with the backend speech provider (no HTTP/auth involved).
 * Run: npm run audio:practice   (needs backend/.env with the speech provider settings; prints counts only)
 * Against the deployed Kokoro (Cloud Run, private): prefix with
 *   SPEECH_PROVIDER=kokoro KOKORO_URL=<service url> KOKORO_AUTH=gcp-id-token KOKORO_TIMEOUT_MS=120000
 * Outside Google Cloud there is no metadata server, so the identity token comes from `gcloud auth print-identity-token`.
 * Incremental: existing files are kept, files no longer referenced are removed, the manifest is rewritten.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadSpeechConfig } from "../../backend/src/speech/config.js";
import { createSpeechProvider } from "../../backend/src/speech/create-speech-provider.js";
import { KokoroSpeechProvider } from "../../backend/src/speech/kokoro-speech-provider.js";
import type { SpeechProvider } from "../../backend/src/speech/types.js";
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";
import { collectFixedPracticePhrases, PRACTICE_AUDIO_VOICE, practiceAudioHash } from "../src/lib/practice/practice-audio.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/audio/practice");
const manifestPath = path.join(root, "src/lib/practice/practice-audio-manifest.json");
const concurrency = 3;
const attempts = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = promisify(execFile);

function createProvider(): SpeechProvider {
  const config = loadSpeechConfig();
  if (config.provider !== "kokoro" || config.kokoroAuth !== "gcp-id-token") return createSpeechProvider(config);
  let cached: { token: string; at: number } | undefined;
  return new KokoroSpeechProvider({
    baseUrl: config.kokoroBaseUrl,
    timeoutMs: config.kokoroTimeoutMs,
    idTokenProvider: {
      async getToken() {
        if (!cached || Date.now() - cached.at > 20 * 60_000) {
          const { stdout } = await run("gcloud", ["auth", "print-identity-token"]);
          cached = { token: stdout.trim(), at: Date.now() };
        }
        return cached.token;
      },
    },
  });
}

async function main() {
  process.loadEnvFile(path.resolve(root, "../backend/.env"));
  const provider = createProvider();
  const phrases = collectFixedPracticePhrases(practiceLessons);
  mkdirSync(outDir, { recursive: true });

  const files: Record<string, string> = {};
  const pending: Array<{ text: string; file: string }> = [];
  for (const text of phrases) {
    const hash = practiceAudioHash(text, PRACTICE_AUDIO_VOICE);
    const file = `${hash}.mp3`;
    files[hash] = file;
    if (!existsSync(path.join(outDir, file))) pending.push({ text, file });
  }

  let done = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let ok = false;
      for (let attempt = 1; attempt <= attempts && !ok; attempt += 1) {
        try {
          const speech = await provider.synthesize({ text: job.text, voice: PRACTICE_AUDIO_VOICE, speed: 1, format: "mp3" });
          if (speech.audio.length === 0) throw new Error("empty audio");
          writeFileSync(path.join(outDir, job.file), speech.audio);
          ok = true;
        } catch {
          await sleep(1_000 * attempt);
        }
      }
      if (ok) done += 1;
      else failed += 1;
      console.log(`progress ${done + failed}/${pending.length} (failed ${failed})`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed > 0) {
    console.error(`${failed} phrase(s) failed; manifest not written. Re-run to retry the missing ones.`);
    process.exit(1);
  }

  const wanted = new Set(Object.values(files));
  let removed = 0;
  for (const name of readdirSync(outDir)) {
    if (!wanted.has(name)) {
      unlinkSync(path.join(outDir, name));
      removed += 1;
    }
  }
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const checksum = createHash("sha256").update(JSON.stringify(sortedFiles)).digest("hex").slice(0, 12);
  writeFileSync(manifestPath, `${JSON.stringify({ voice: PRACTICE_AUDIO_VOICE, format: "mp3", checksum, files: sortedFiles }, null, 2)}\n`);
  console.log(`phrases ${phrases.length}, generated ${done}, reused ${phrases.length - pending.length}, removed ${removed}`);
}

void main();
