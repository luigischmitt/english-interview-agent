import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";
import { getTranscriptionEvaluationCase, transcriptionEvaluationCorpus } from "./transcription-evaluation-corpus.js";

const execFile = promisify(execFileCallback);
const sampleRate = 16_000;
const bytesPerSample = 2;
const frameDurationMs = 100;
const samplesPerFrame = sampleRate * frameDurationMs / 1_000;
const bytesPerFrame = samplesPerFrame * bytesPerSample;
const trailingSilenceMs = 4_000;
/** With --server-finalize the client keeps streaming silence until the server decides the answer ended. */
const serverFinalizeSilenceMs = 15_000;
const minimumTranscriptSimilarity = 0.75;
const assessmentWaitMs = 30_000;
const defaultText = "In my last role, I improved a slow reporting service that our support team used every day. First, I reviewed the database queries and added indexes where the data showed they would help. Then I worked with the frontend team to remove a request that was repeated on every page. The response time went from about four seconds to under one second. We checked the change with realistic data, watched the service after release, and documented what we learned. I also shared the measurements with the team so we could use them when planning the next improvements.";

export type AudioE2EOptions = {
  backendUrl: URL;
  text: string;
  speed: number;
  speechThreshold: number;
  timeoutMs: number;
  ffmpeg: string;
  maxDurationMs: number;
  requireAssessment: boolean;
  evaluationProfile: string | null;
  suite: boolean;
  evaluationThresholdExplicit: boolean;
  /** Do not send `finalize` on `silence-detected`; keep streaming silence until the server finalizes (like the browser). */
  serverFinalize?: boolean;
};

type Options = AudioE2EOptions;

type StreamMessage = {
  type?: string;
  code?: string;
  protocol?: number;
  status?: string;
  durationMs?: number;
  transcript?: string;
  reason?: string;
  position?: number;
  segmented?: boolean;
  scores?: { accuracy?: unknown; fluency?: unknown; prosody?: unknown };
};

export type AudioE2EMetrics = {
  requireAssessment: boolean;
  speechGenerationMs: number;
  connectToReadyMs: number | null;
  firstSpeechMs: number | null;
  transcriptionMs: number | null;
  finalizationToCompleteMs: number | null;
  /** Time from the end of the synthetic speech audio to `complete`. */
  speechEndToCompleteMs?: number | null;
  queueWaitMs: number | null;
  silenceDetectedMs: number | null;
  completeMs: number | null;
  streamErrors: Array<{ type: "error"; code?: string }>;
  missingEvents: string[];
  transcriptCharacters: number;
  transcriptSimilarity: number | null;
  expectedWords: number;
  omittedWords: number;
  substitutedWords: number;
  insertedWords: number;
  completionStatus: string | null;
  assessmentStatus: string | null;
  segmented: boolean | null;
  assessedDurationMs: number | null;
  assessmentScoresAvailable: { accuracy: boolean; fluency: boolean; prosody: boolean } | null;
};

export type AudioE2ESuiteMetrics = {
  cases: number;
  successfulCases: number;
  meanSimilarity: number | null;
  expectedWords: number;
  omittedWords: number;
  substitutedWords: number;
  insertedWords: number;
  meanQueueWaitMs: number | null;
  meanWhisperMs: number | null;
  meanFinalizationToCompleteMs: number | null;
};

export function isSuccessfulAudioE2ERun(metrics: AudioE2EMetrics): boolean {
  return metrics.completionStatus === "complete"
    && metrics.transcriptCharacters > 0
    && metrics.transcriptSimilarity !== null
    && metrics.transcriptSimilarity >= minimumTranscriptSimilarity
    && metrics.streamErrors.length === 0
    && metrics.missingEvents.length === 0
    && (!metrics.requireAssessment || (metrics.assessmentStatus === "available"
      && metrics.segmented === true
      && metrics.assessmentScoresAvailable !== null
      && Object.values(metrics.assessmentScoresAvailable).some(Boolean)));
}

export function calculateTranscriptSimilarity(reference: string, transcript: string): number {
  return calculateTranscriptErrors(reference, transcript).similarity;
}

export function calculateTranscriptErrors(reference: string, transcript: string, normalizeEnglishNumbers = false): { expectedWords: number; omittedWords: number; substitutedWords: number; insertedWords: number; similarity: number } {
  const tokenize = (value: string) => {
    const tokens = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}]+(?:'[\p{L}]+)*|\p{N}+/gu) ?? [];
    return normalizeEnglishNumbers ? normalizeNumberTokens(tokens) : tokens;
  };
  const expected = tokenize(reference);
  const actual = tokenize(transcript);
  const matrix: Array<Array<{ distance: number; omitted: number; substituted: number; inserted: number }>> = Array.from({ length: expected.length + 1 }, () => []);
  for (let i = 0; i <= expected.length; i += 1) matrix[i][0] = { distance: i, omitted: i, substituted: 0, inserted: 0 };
  for (let j = 0; j <= actual.length; j += 1) matrix[0][j] = { distance: j, omitted: 0, substituted: 0, inserted: j };
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= actual.length; j += 1) {
      const equal = expected[i - 1] === actual[j - 1];
      const candidates = [
        { ...matrix[i - 1][j], distance: matrix[i - 1][j].distance + 1, omitted: matrix[i - 1][j].omitted + 1 },
        { ...matrix[i][j - 1], distance: matrix[i][j - 1].distance + 1, inserted: matrix[i][j - 1].inserted + 1 },
        { ...matrix[i - 1][j - 1], distance: matrix[i - 1][j - 1].distance + (equal ? 0 : 1), substituted: matrix[i - 1][j - 1].substituted + (equal ? 0 : 1) },
      ];
      matrix[i][j] = candidates.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best);
    }
  }
  const errors = matrix[expected.length][actual.length];
  return {
    expectedWords: expected.length,
    omittedWords: errors.omitted,
    substitutedWords: errors.substituted,
    insertedWords: errors.inserted,
    similarity: Math.round(Math.max(0, 1 - errors.distance / Math.max(1, expected.length)) * 1_000) / 1_000,
  };
}

const smallNumberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const tensNumberWords: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Normalize only unambiguous English cardinal forms used by the numbers reference case. */
function normalizeNumberTokens(tokens: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (/^\d+$/u.test(token)) {
      normalized.push(`#${token.replace(/^0+(?=\d)/u, "")}`);
      index += 1;
      continue;
    }
    const small = smallNumberWords[token];
    const tens = tensNumberWords[token];
    if (small === undefined && tens === undefined) {
      normalized.push(token);
      index += 1;
      continue;
    }

    let value = small ?? tens ?? 0;
    let consumed = 1;
    if (tens !== undefined && smallNumberWords[tokens[index + 1]] >= 1 && smallNumberWords[tokens[index + 1]] <= 9) {
      value += smallNumberWords[tokens[index + 1]];
      consumed += 1;
    } else if (tokens[index + 1] === "hundred") {
      value *= 100;
      consumed += 1;
      if (tokens[index + consumed] === "and") consumed += 1;
      const remainderTens = tensNumberWords[tokens[index + consumed]];
      const remainderSmall = smallNumberWords[tokens[index + consumed]];
      if (remainderTens !== undefined) {
        value += remainderTens;
        consumed += 1;
        if (smallNumberWords[tokens[index + consumed]] >= 1 && smallNumberWords[tokens[index + consumed]] <= 9) {
          value += smallNumberWords[tokens[index + consumed]];
          consumed += 1;
        }
      } else if (remainderSmall !== undefined) {
        value += remainderSmall;
        consumed += 1;
      }
    }
    normalized.push(`#${value}`);
    index += consumed;
  }
  return normalized;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Options {
  const values: Record<string, string> = {
    "backend-url": env.AUDIO_E2E_BACKEND_URL ?? "http://localhost:3001",
    text: env.AUDIO_E2E_TEXT ?? defaultText,
    speed: env.AUDIO_E2E_SPEED ?? "1",
    "speech-threshold": env.AUDIO_E2E_SPEECH_THRESHOLD ?? "0.025",
    "timeout-ms": env.AUDIO_E2E_TIMEOUT_MS ?? "120000",
    ffmpeg: env.AUDIO_E2E_FFMPEG ?? "ffmpeg",
    "max-duration-seconds": env.AUDIO_E2E_MAX_DURATION_SECONDS ?? "180",
    case: env.AUDIO_E2E_CASE ?? "",
  };
  const allowed = new Set(Object.keys(values));
  let thresholdExplicit = env.AUDIO_E2E_SPEECH_THRESHOLD !== undefined;
  let requireAssessment = env.AUDIO_E2E_REQUIRE_ASSESSMENT === "true";
  let suite = env.AUDIO_E2E_SUITE === "true";
  let serverFinalize = env.AUDIO_E2E_SERVER_FINALIZE === "true";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error("Arguments must use --option value syntax.");
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    if (name === "require-assessment") {
      if (inlineValue === undefined) requireAssessment = true;
      else if (inlineValue === "true" || inlineValue === "false") requireAssessment = inlineValue === "true";
      else throw new Error("--require-assessment must be a boolean flag.");
      continue;
    }
    if (name === "server-finalize") {
      if (inlineValue === undefined) serverFinalize = true;
      else if (inlineValue === "true" || inlineValue === "false") serverFinalize = inlineValue === "true";
      else throw new Error("--server-finalize must be a boolean flag.");
      continue;
    }
    if (name === "suite") {
      if (inlineValue === undefined) suite = true;
      else if (inlineValue === "true" || inlineValue === "false") suite = inlineValue === "true";
      else throw new Error("--suite must be a boolean flag.");
      continue;
    }
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}.`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    values[name] = value;
    if (name === "speech-threshold") thresholdExplicit = true;
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
  const configuredSpeechThreshold = parseBoundedNumber(values["speech-threshold"], "--speech-threshold", 0.015, 0.05);
  const timeoutMs = parseBoundedInteger(values["timeout-ms"], "--timeout-ms", 1_000, 600_000);
  const maxDurationMs = parseBoundedInteger(values["max-duration-seconds"], "--max-duration-seconds", 1, 180) * 1_000;
  const evaluationCase = values.case ? getTranscriptionEvaluationCase(values.case) : undefined;
  if (values.case && !evaluationCase) throw new Error("--case must name a case in the versioned evaluation corpus.");
  const text = (evaluationCase?.reference ?? values.text).trim();
  if (!text || text.length > 4_000) throw new Error("--text must contain between 1 and 4000 characters.");
  if (!values.ffmpeg.trim()) throw new Error("--ffmpeg cannot be empty.");

  const speechThreshold = thresholdExplicit || evaluationCase?.speechThreshold === undefined
    ? configuredSpeechThreshold
    : evaluationCase.speechThreshold;
  return { backendUrl, text, speed, speechThreshold, timeoutMs, ffmpeg: values.ffmpeg, maxDurationMs, requireAssessment, evaluationProfile: evaluationCase?.profile ?? null, suite, evaluationThresholdExplicit: thresholdExplicit, serverFinalize };
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

export function applyEvaluationAudioProfile(pcm: Buffer, profile: string | null): Buffer {
  const output = Buffer.from(pcm);
  if (profile === "quiet") {
    for (let offset = 0; offset < output.length; offset += bytesPerSample) output.writeInt16LE(Math.round(output.readInt16LE(offset) * 0.55), offset);
  } else if (profile === "noise") {
    let state = 0x13579bdf;
    for (let offset = 0; offset < output.length; offset += bytesPerSample) {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      const sample = output.readInt16LE(offset);
      const noise = ((state >>> 16) - 32_768) * 0.012;
      output.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(sample + noise))), offset);
    }
  }
  // The pauses case uses sentence punctuation in its reference so TTS places a
  // natural pause at a known sentence boundary. Never cut synthesized PCM at
  // an arbitrary sample offset, which could split a word or phoneme.
  return output;
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

function backendEndpointUrl(backendUrl: URL, endpointPath: string): URL {
  const url = new URL(backendUrl);
  const basePath = backendUrl.pathname.replace(/\/+$/u, "");
  const endpoint = endpointPath.replace(/^\/+/, "");
  url.pathname = `${basePath}/${endpoint}`;
  return url;
}

export function buildSpeechUrl(backendUrl: URL): URL {
  return backendEndpointUrl(backendUrl, "/api/v1/speech");
}

export function buildStreamUrl(backendUrl: URL): URL {
  const url = backendEndpointUrl(backendUrl, "/api/v1/transcriptions/stream");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

async function generateAndConvert(options: Options, directory: string): Promise<{ pcm: Buffer; speechGenerationMs: number }> {
  const speechUrl = buildSpeechUrl(options.backendUrl);
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
  const pcm = applyEvaluationAudioProfile(await readFile(pcmPath), options.evaluationProfile);
  if (pcm.length === 0 || pcm.length % bytesPerSample !== 0) throw new Error("ffmpeg produced invalid 16-bit PCM audio.");
  const durationMs = pcm.length / (sampleRate * bytesPerSample) * 1_000;
  if (durationMs + (options.serverFinalize ? serverFinalizeSilenceMs : trailingSilenceMs) > options.maxDurationMs) {
    throw new Error("Generated audio exceeds --max-duration-seconds; use a shorter --text value.");
  }
  return { pcm, speechGenerationMs };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(socket: WebSocket, data: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(data, (error) => error ? reject(new Error("WebSocket send failed.")) : resolve());
  });
}

export async function exerciseStream(
  options: Options,
  pcm: Buffer,
  speechGenerationMs: number,
  trailingSilenceDurationMs = trailingSilenceMs,
): Promise<AudioE2EMetrics> {
  const url = buildStreamUrl(options.backendUrl);
  const socket = new WebSocket(url, { handshakeTimeout: 10_000, perMessageDeflate: false });
  const metrics: AudioE2EMetrics = {
    requireAssessment: options.requireAssessment,
    speechGenerationMs,
    connectToReadyMs: null,
    firstSpeechMs: null,
    transcriptionMs: null,
    finalizationToCompleteMs: null,
    speechEndToCompleteMs: null,
    queueWaitMs: null,
    silenceDetectedMs: null,
    completeMs: null,
    streamErrors: [],
    missingEvents: [],
    transcriptCharacters: 0,
    transcriptSimilarity: null,
    expectedWords: 0,
    omittedWords: 0,
    substitutedWords: 0,
    insertedWords: 0,
    completionStatus: null,
    assessmentStatus: null,
    segmented: null,
    assessedDurationMs: null,
    assessmentScoresAvailable: null,
  };
  const frames = framePcm(pcm, options.serverFinalize ? Math.max(trailingSilenceDurationMs, serverFinalizeSilenceMs) : trailingSilenceDurationMs);
  const speechAudioMs = pcm.length / (sampleRate * bytesPerSample) * 1_000;
  let openedAt = 0;
  let streamStartedAt = 0;
  let ready = false;
  let shouldStopSending = false;
  let rejected: Error | null = null;
  let mergedTranscript = "";
  let queuedAt: number | null = null;
  let transcriptionStartedAt: number | null = null;
  let finalizedAt: number | null = null;
  let resolveComplete: (() => void) | null = null;
  let rejectComplete: ((error: Error) => void) | null = null;
  let completeReceived = false;
  let assessmentWaitTimer: ReturnType<typeof setTimeout> | null = null;
  const completed = new Promise<void>((resolve, reject) => { resolveComplete = resolve; rejectComplete = reject; });
  void completed.catch(() => undefined);
  let timeout = setTimeout(() => rejectComplete?.(new Error("Audio stream timed out.")), options.timeoutMs);

  const finalize = (reason: "silence" | "manual"): Promise<void> => {
    if (socket.readyState !== WebSocket.OPEN) return Promise.resolve();
    finalizedAt ??= performance.now();
    return send(socket, JSON.stringify({ type: "finalize", reason }));
  };

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
    if (message.type === "transcription-queued") {
      queuedAt = now;
      return;
    }
    if (message.type === "transcription-started") {
      transcriptionStartedAt = now;
      if (queuedAt !== null) metrics.queueWaitMs = Math.max(0, Math.round(now - queuedAt));
      return;
    }
    if (message.type === "finalizing" && options.serverFinalize) {
      // The server decided the answer ended (Cartesia turn end or VAD): stop streaming like the browser does.
      finalizedAt ??= now;
      shouldStopSending = true;
      return;
    }
    if (message.type === "silence-detected") {
      metrics.silenceDetectedMs ??= Math.round(now - streamStartedAt);
      if (options.serverFinalize) return;
      shouldStopSending = true;
      void finalize("silence").catch((error: Error) => rejectComplete?.(error));
      return;
    }
    if (message.type === "complete") {
      if (completeReceived) return;
      completeReceived = true;
      if (finalizedAt !== null) metrics.finalizationToCompleteMs = Math.round(now - finalizedAt);
      metrics.completionStatus = message.status ?? "unknown";
      metrics.completeMs = Math.round(now - streamStartedAt);
      metrics.speechEndToCompleteMs = Math.round(now - (streamStartedAt + speechAudioMs));
      shouldStopSending = true;
      metrics.transcriptionMs = transcriptionStartedAt === null ? null : Math.round(now - transcriptionStartedAt);
      if (typeof message.transcript === "string") mergedTranscript = message.transcript;
      metrics.transcriptCharacters = mergedTranscript.length;
      const transcriptErrors = calculateTranscriptErrors(options.text, mergedTranscript, options.evaluationProfile === "numbers");
      metrics.transcriptSimilarity = transcriptErrors.similarity;
      metrics.expectedWords = transcriptErrors.expectedWords;
      metrics.omittedWords = transcriptErrors.omittedWords;
      metrics.substitutedWords = transcriptErrors.substitutedWords;
      metrics.insertedWords = transcriptErrors.insertedWords;
      if (options.requireAssessment) {
        clearTimeout(timeout);
        assessmentWaitTimer = setTimeout(() => {
          metrics.assessmentStatus = "timeout";
          resolveComplete?.();
        }, Math.min(assessmentWaitMs, options.timeoutMs));
      } else resolveComplete?.();
      return;
    }
    if (message.type === "assessment") {
      if (!options.requireAssessment || metrics.assessmentStatus !== null) return;
      metrics.assessmentStatus = typeof message.status === "string" ? message.status : "unknown";
      metrics.segmented = typeof message.segmented === "boolean" ? message.segmented : null;
      metrics.assessedDurationMs = Number.isFinite(message.durationMs) && (message.durationMs ?? -1) >= 0 ? message.durationMs! : null;
      const scores = message.scores;
      metrics.assessmentScoresAvailable = scores ? {
        accuracy: typeof scores.accuracy === "number" && Number.isFinite(scores.accuracy),
        fluency: typeof scores.fluency === "number" && Number.isFinite(scores.fluency),
        prosody: typeof scores.prosody === "number" && Number.isFinite(scores.prosody),
      } : { accuracy: false, fluency: false, prosody: false };
      if (assessmentWaitTimer) clearTimeout(assessmentWaitTimer);
      resolveComplete?.();
      return;
    }
    if (message.type === "error") {
      metrics.streamErrors.push({ type: message.type, ...(message.code ? { code: message.code } : {}) });
      rejected = new Error(`WebSocket error${message.code ? ` (${message.code})` : ""}.`);
      shouldStopSending = true;
      rejectComplete?.(rejected);
    }
  });
  socket.on("error", () => rejectComplete?.(new Error("WebSocket connection failed.")));
  socket.on("close", (code) => {
    if (metrics.completeMs === null) rejectComplete?.(new Error(`WebSocket closed before completion (code ${code}).`));
    else if (options.requireAssessment && metrics.assessmentStatus === null) {
      metrics.assessmentStatus = "closed";
      resolveComplete?.();
    }
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
      await finalize("manual");
    }
    await completed;
  } catch (error) {
    rejected = error instanceof Error ? error : new Error("Audio stream failed.");
  } finally {
    clearTimeout(timeout);
    if (assessmentWaitTimer) clearTimeout(assessmentWaitTimer);
    if (socket.readyState === WebSocket.OPEN) socket.close();
  }
  if (rejected) throw rejected;
  if (!ready) metrics.missingEvents.push("ready");
  if (metrics.firstSpeechMs === null) metrics.missingEvents.push("speech-started");
  // With server-side finalization (e.g. Cartesia turn end) the local VAD need not report silence first.
  if (metrics.silenceDetectedMs === null && !options.serverFinalize) metrics.missingEvents.push("silence-detected");
  if (metrics.completeMs === null) metrics.missingEvents.push("complete");
  if (options.requireAssessment && metrics.assessmentStatus === null) metrics.missingEvents.push("assessment");
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

export async function runAudioEvaluationSuite(options: Options): Promise<AudioE2ESuiteMetrics> {
  const results: AudioE2EMetrics[] = [];
  for (const evaluationCase of transcriptionEvaluationCorpus) {
    results.push(await runAudioStreamE2E({
      ...options,
      text: evaluationCase.reference,
      evaluationProfile: evaluationCase.profile,
      speechThreshold: options.evaluationThresholdExplicit ? options.speechThreshold : evaluationCase.speechThreshold ?? options.speechThreshold,
      suite: false,
    }));
  }
  return aggregateAudioE2EMetrics(results);
}

export function aggregateAudioE2EMetrics(results: readonly AudioE2EMetrics[]): AudioE2ESuiteMetrics {
  const mean = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return present.length ? Math.round(present.reduce((sum, value) => sum + value, 0) / present.length) : null;
  };
  return {
    cases: results.length,
    successfulCases: results.filter(isSuccessfulAudioE2ERun).length,
    meanSimilarity: results.length ? Math.round(results.reduce((sum, result) => sum + (result.transcriptSimilarity ?? 0), 0) / results.length * 1_000) / 1_000 : null,
    expectedWords: results.reduce((sum, result) => sum + result.expectedWords, 0),
    omittedWords: results.reduce((sum, result) => sum + result.omittedWords, 0),
    substitutedWords: results.reduce((sum, result) => sum + result.substitutedWords, 0),
    insertedWords: results.reduce((sum, result) => sum + result.insertedWords, 0),
    meanQueueWaitMs: mean(results.map((result) => result.queueWaitMs)),
    meanWhisperMs: mean(results.map((result) => result.transcriptionMs)),
    meanFinalizationToCompleteMs: mean(results.map((result) => result.finalizationToCompleteMs)),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.suite) {
    const metrics = await runAudioEvaluationSuite(options);
    const ok = metrics.successfulCases === metrics.cases;
    process.stdout.write(`${JSON.stringify({ ok, ...(ok ? {} : { error: "One or more evaluation cases did not complete successfully." }), protocol: 2, sampleRate, channels: 1, encoding: "s16le", frameDurationMs, metrics }, null, 2)}\n`);
    if (!ok) process.exitCode = 1;
    return;
  }
  const metrics = await runAudioStreamE2E(options);
  const ok = isSuccessfulAudioE2ERun(metrics);
  process.stdout.write(`${JSON.stringify({ ok, ...(ok ? {} : { error: "Audio stream did not complete successfully." }), protocol: 2, sampleRate, channels: 1, encoding: "s16le", frameDurationMs, metrics }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && basename(process.argv[1]) === "audio-stream-e2e.ts") {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Audio E2E harness failed.";
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
