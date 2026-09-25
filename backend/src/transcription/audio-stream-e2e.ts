import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const execFile = promisify(execFileCallback);
const sampleRate = 16_000;
const bytesPerSample = 2;
const frameDurationMs = 100;
const samplesPerFrame = sampleRate * frameDurationMs / 1_000;
const bytesPerFrame = samplesPerFrame * bytesPerSample;
const trailingSilenceMs = 4_000;
const defaultText = "In my last role, I improved a slow reporting service. I measured the queries, added the right indexes, and reduced the response time from four seconds to under one second. I worked with the team to verify the change and monitor it after release.";

type Options = {
  backendUrl: URL;
  text: string;
  speed: number;
  speechThreshold: number;
  timeoutMs: number;
  ffmpeg: string;
  maxDurationMs: number;
};

type StreamMessage = {
  type?: string;
  code?: string;
  protocol?: number;
  status?: string;
  windowIndex?: number;
  durationMs?: number;
  transcript?: string;
  reason?: string;
};

export type AudioE2EMetrics = {
  speechGenerationMs: number;
  connectToReadyMs: number | null;
  firstSpeechMs: number | null;
  firstPartialMs: number | null;
  silenceDetectedMs: number | null;
  completeMs: number | null;
  partialCount: number;
  partialWindows: number[];
  transcriptCharacters: number;
  completionStatus: string | null;
};

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const values: Record<string, string> = {
    "backend-url": env.AUDIO_E2E_BACKEND_URL ?? "http://localhost:3001",
    text: env.AUDIO_E2E_TEXT ?? defaultText,
    speed: env.AUDIO_E2E_SPEED ?? "1",
    "speech-threshold": env.AUDIO_E2E_SPEECH_THRESHOLD ?? "0.025",
    "timeout-ms": env.AUDIO_E2E_TIMEOUT_MS ?? "120000",
    ffmpeg: env.AUDIO_E2E_FFMPEG ?? "ffmpeg",
    "max-duration-seconds": env.AUDIO_E2E_MAX_DURATION_SECONDS ?? "180",
  };
  const allowed = new Set(Object.keys(values));
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error("Arguments must use --option value syntax.");
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}.`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    values[name] = value;
  }

  let backendUrl: URL;
  try {
    backendUrl = new URL(values["backend-url"]);
  } catch {
    throw new Error("--backend-url must be a valid HTTP URL.");
  }
  if (!["http:", "https:"].includes(backendUrl.protocol) || backendUrl.username || backendUrl.password || backendUrl.search || backendUrl.hash) {
    throw new Error("--backend-url must be HTTP(S) without credentials, query parameters, or fragments.");
  }
  backendUrl.pathname = backendUrl.pathname.replace(/\/$/, "");

  const speed = parseBoundedNumber(values.speed, "--speed", 0.25, 4);
  const speechThreshold = parseBoundedNumber(values["speech-threshold"], "--speech-threshold", 0.025, 0.15);
  const timeoutMs = parseBoundedInteger(values["timeout-ms"], "--timeout-ms", 1_000, 600_000);
  const maxDurationMs = parseBoundedInteger(values["max-duration-seconds"], "--max-duration-seconds", 1, 180) * 1_000;
  const text = values.text.trim();
  if (!text || text.length > 4_000) throw new Error("--text must contain between 1 and 4000 characters.");
  if (!values.ffmpeg.trim()) throw new Error("--ffmpeg cannot be empty.");

  return { backendUrl, text, speed, speechThreshold, timeoutMs, ffmpeg: values.ffmpeg, maxDurationMs };
}

function parseBoundedNumber(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseBoundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function framePcm(pcm: Buffer, silenceMs = trailingSilenceMs): Buffer[] {
  if (pcm.length === 0 || pcm.length % bytesPerSample !== 0) throw new Error("PCM must contain complete 16-bit samples.");
  if (!Number.isInteger(silenceMs) || silenceMs < 0) throw new Error("Silence duration must be a non-negative integer.");
  const silenceBytes = sampleRate * silenceMs / 1_000 * bytesPerSample;
  const paddedLength = Math.ceil((pcm.length + silenceBytes) / bytesPerFrame) * bytesPerFrame;
  const completePcm = Buffer.alloc(paddedLength);
  pcm.copy(completePcm);
  const frames: Buffer[] = [];
  for (let offset = 0; offset < completePcm.length; offset += bytesPerFrame) {
    frames.push(completePcm.subarray(offset, offset + bytesPerFrame));
  }
  return frames;
}

export function rmsLevel(frame: Buffer): number {
  if (frame.length === 0 || frame.length % bytesPerSample !== 0) throw new Error("PCM frame must contain complete 16-bit samples.");
  let squareSum = 0;
  for (let offset = 0; offset < frame.length; offset += bytesPerSample) {
    const sample = frame.readInt16LE(offset) / 32_768;
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / (frame.length / bytesPerSample));
}

export function mergeTranscriptWindow(previous: string, next: string): string {
  const currentText = previous.trim();
  const nextText = next.trim();
  if (!currentText) return nextText;
  if (!nextText) return currentText;
  const previousWords = currentText.split(/\s+/u);
  const nextWords = nextText.split(/\s+/u);
  const normalize = (token: string) => token.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}']/gu, "");
  const previousNormalized = previousWords.map(normalize);
  const nextNormalized = nextWords.map(normalize);
  const maximumOverlap = Math.min(previousWords.length, nextWords.length, 20);
  let overlap = 0;
  for (let size = maximumOverlap; size >= 2; size -= 1) {
    const suffix = previousNormalized.slice(-size);
    const prefix = nextNormalized.slice(0, size);
    if (suffix.every((token, index) => token && token === prefix[index])) {
      overlap = size;
      break;
    }
  }
  const addition = nextWords.slice(overlap).join(" ");
  return addition ? `${currentText} ${addition}`.trim() : currentText;
}

export async function fetchSpeechAudio(
  speechUrl: URL,
  payload: { text: string; speed: number },
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(speechUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Speech generation failed with HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("audio/")) throw new Error("Speech endpoint did not return audio.");
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0 || audio.length > 20 * 1024 * 1024) throw new Error("Generated audio is empty or exceeds the 20 MiB safety limit.");
    if (controller.signal.aborted) throw new Error("Speech generation timed out while reading the audio body.");
    return audio;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Speech generation timed out. Check the local backend and Kokoro service.");
    if (error instanceof Error && (error.message.startsWith("Speech generation failed with HTTP") || error.message.startsWith("Speech endpoint") || error.message.startsWith("Generated audio"))) {
      throw error;
    }
    throw new Error("Speech generation failed. Check the local backend and Kokoro service.");
  } finally {
    clearTimeout(timeout);
  }
}

async function generateAndConvert(options: Options, directory: string): Promise<{ pcm: Buffer; speechGenerationMs: number }> {
  const speechUrl = new URL(`${options.backendUrl.pathname}/api/v1/speech`, options.backendUrl);
  const startedAt = performance.now();
  const audio = await fetchSpeechAudio(speechUrl, { text: options.text, speed: options.speed }, options.timeoutMs);
  const speechGenerationMs = Math.round(performance.now() - startedAt);

  const sourcePath = join(directory, "speech-audio.mp3");
  const pcmPath = join(directory, "speech-audio.pcm");
  await writeFile(sourcePath, audio, { mode: 0o600 });
  try {
    await execFile(options.ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", sourcePath, "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(sampleRate), pcmPath], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error("Audio conversion failed. Check that ffmpeg is installed and the speech endpoint returned a supported audio format.");
  }
  const pcm = await readFile(pcmPath);
  if (pcm.length === 0 || pcm.length % bytesPerSample !== 0) throw new Error("ffmpeg produced invalid 16-bit PCM audio.");
  const durationMs = pcm.length / (sampleRate * bytesPerSample) * 1_000;
  if (durationMs + trailingSilenceMs > options.maxDurationMs) {
    throw new Error("Generated audio exceeds --max-duration-seconds; use a shorter --text value.");
  }
  return { pcm, speechGenerationMs };
}

function streamUrl(backendUrl: URL): URL {
  const url = new URL(backendUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${backendUrl.pathname}/api/v1/transcriptions/stream`;
  return url;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(socket: WebSocket, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(data, (error) => error ? reject(new Error("WebSocket send failed.")) : resolve());
  });
}

async function exerciseStream(options: Options, pcm: Buffer, speechGenerationMs: number): Promise<AudioE2EMetrics> {
  const url = streamUrl(options.backendUrl);
  const socket = new WebSocket(url, { handshakeTimeout: 10_000, perMessageDeflate: false });
  const metrics: AudioE2EMetrics = {
    speechGenerationMs,
    connectToReadyMs: null,
    firstSpeechMs: null,
    firstPartialMs: null,
    silenceDetectedMs: null,
    completeMs: null,
    partialCount: 0,
    partialWindows: [],
    transcriptCharacters: 0,
    completionStatus: null,
  };
  const frames = framePcm(pcm);
  let openedAt = 0;
  let streamStartedAt = 0;
  let ready = false;
  let shouldStopSending = false;
  let rejected: Error | null = null;
  let mergedTranscript = "";
  let resolveComplete: (() => void) | null = null;
  let rejectComplete: ((error: Error) => void) | null = null;
  const completed = new Promise<void>((resolve, reject) => { resolveComplete = resolve; rejectComplete = reject; });
  void completed.catch(() => undefined);
  const timeout = setTimeout(() => rejectComplete?.(new Error("Audio stream timed out.")), options.timeoutMs);

  socket.on("open", () => {
    openedAt = performance.now();
    streamStartedAt = openedAt;
    void send(socket, JSON.stringify({ type: "start", version: 2, sampleRate, channels: 1, encoding: "s16le", speechThreshold: options.speechThreshold }))
      .catch((error: Error) => rejectComplete?.(error));
  });
  socket.on("message", (data) => {
    let message: StreamMessage;
    try { message = JSON.parse(data.toString()) as StreamMessage; } catch { return; }
    const now = performance.now();
    if (message.type === "ready") {
      if (message.protocol !== 2) {
        rejectComplete?.(new Error("Backend did not acknowledge WebSocket protocol v2."));
        return;
      }
      ready = true;
      metrics.connectToReadyMs = Math.round(now - openedAt);
      return;
    }
    if (message.type === "speech-started") {
      metrics.firstSpeechMs ??= Math.round(now - streamStartedAt);
      return;
    }
    if (message.type === "partial") {
      metrics.firstPartialMs ??= Math.round(now - streamStartedAt);
      metrics.partialCount += 1;
      if (typeof message.windowIndex === "number") metrics.partialWindows.push(message.windowIndex);
      if (typeof message.transcript === "string") {
        mergedTranscript = mergeTranscriptWindow(mergedTranscript, message.transcript);
        metrics.transcriptCharacters = mergedTranscript.length;
      }
      return;
    }
    if (message.type === "silence-detected") {
      metrics.silenceDetectedMs ??= Math.round(now - streamStartedAt);
      shouldStopSending = true;
      if (socket.readyState === WebSocket.OPEN) {
        void send(socket, JSON.stringify({ type: "finalize", reason: "silence" })).catch((error: Error) => rejectComplete?.(error));
      }
      return;
    }
    if (message.type === "complete") {
      metrics.completionStatus = message.status ?? "unknown";
      metrics.completeMs = Math.round(now - streamStartedAt);
      resolveComplete?.();
      return;
    }
    if (message.type === "error" || message.type === "partial-error") {
      rejected = new Error(`WebSocket ${message.type}${message.code ? ` (${message.code})` : ""}.`);
      shouldStopSending = true;
      rejectComplete?.(rejected);
    }
  });
  socket.on("error", () => rejectComplete?.(new Error("WebSocket connection failed.")));
  socket.on("close", (code) => {
    if (metrics.completeMs === null) rejectComplete?.(new Error(`WebSocket closed before completion (code ${code}).`));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const openTimeout = setTimeout(() => reject(new Error("WebSocket connection timed out.")), 10_000);
      socket.once("open", () => { clearTimeout(openTimeout); resolve(); });
      socket.once("error", () => { clearTimeout(openTimeout); reject(new Error("WebSocket connection failed.")); });
    });
    for (let index = 0; index < frames.length && !shouldStopSending; index += 1) {
      if (!ready) {
        await wait(10);
        index -= 1;
        continue;
      }
      const frameStartedAt = performance.now();
      await send(socket, frames[index]);
      await send(socket, JSON.stringify({ type: "level", value: rmsLevel(frames[index]) }));
      const nextFrameAt = streamStartedAt + (index + 1) * frameDurationMs;
      await wait(Math.max(0, nextFrameAt - performance.now()));
      if (performance.now() - frameStartedAt > frameDurationMs * 5) {
        throw new Error("Audio stream fell behind real-time pacing.");
      }
    }
    if (!shouldStopSending && socket.readyState === WebSocket.OPEN) {
      await send(socket, JSON.stringify({ type: "finalize", reason: "manual" }));
    }
    await completed;
  } catch (error) {
    rejected = error instanceof Error ? error : new Error("Audio stream failed.");
  } finally {
    clearTimeout(timeout);
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }
  if (rejected) throw rejected;
  if (!ready || metrics.firstSpeechMs === null || metrics.firstPartialMs === null || metrics.silenceDetectedMs === null || metrics.completeMs === null) {
    throw new Error("The stream completed without all expected v2 events (ready, speech-started, partial, silence-detected, complete).");
  }
  if (metrics.completionStatus !== "complete") throw new Error(`Transcription completed with status ${metrics.completionStatus}.`);
  return metrics;
}

export async function runAudioStreamE2E(options: Options): Promise<AudioE2EMetrics> {
  const directory = await mkdtemp(join(tmpdir(), "interview-audio-e2e-"));
  try {
    const generated = await generateAndConvert(options, directory);
    return await exerciseStream(options, generated.pcm, generated.speechGenerationMs);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const metrics = await runAudioStreamE2E(options);
  process.stdout.write(`${JSON.stringify({ ok: true, protocol: 2, sampleRate, channels: 1, encoding: "s16le", frameDurationMs, metrics }, null, 2)}\n`);
}

if (process.argv[1] && basename(process.argv[1]) === "audio-stream-e2e.ts") {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Audio E2E harness failed.";
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
