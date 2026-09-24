import { randomUUID } from "node:crypto";

import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector, type VadConfig } from "./voice-activity-detector.js";
import type { TranscriptionService } from "./types.js";

export const pcmSampleRate = 16_000;
export const transcriptionWindowMs = 10_000;
export const transcriptionOverlapMs = 1_000;
const bytesPerSample = 2;
const windowSamples = pcmSampleRate * transcriptionWindowMs / 1_000;
const overlapSamples = pcmSampleRate * transcriptionOverlapMs / 1_000;
const windowStepSamples = windowSamples - overlapSamples;

export type StreamingLimits = {
  maxDurationMs: number;
  maxBytes: number;
  maxQueueBytes: number;
  maxActiveSessions: number;
};

export const defaultStreamingLimits: StreamingLimits = {
  maxDurationMs: 180_000,
  maxBytes: 6 * 1024 * 1024,
  maxQueueBytes: 512 * 1024,
  maxActiveSessions: 8,
};

export type AudioWindow = {
  index: number;
  startSample: number;
  endSample: number;
  durationMs: number;
  pcm: Buffer;
};

export type StreamingSession = {
  id: string;
  chunks: Buffer[];
  bytes: number;
  queuedBytes: number;
  startedAt: number;
  lastSequence: number;
  samplesReceived: number;
  lastWindowEndSample: number;
  windowIndex: number;
  vad: VoiceActivityDetector;
  config: VadConfig;
  limits: StreamingLimits;
  cancelled: boolean;
};

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(pcmSampleRate, 24);
  header.writeUInt32LE(pcmSampleRate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class StreamingTranscriptionSessions {
  private readonly sessions = new Map<string, StreamingSession>();

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly now: () => number = Date.now,
    private readonly config: VadConfig = defaultVadConfig,
    private readonly limits: StreamingLimits = defaultStreamingLimits,
  ) {}

  create(speechThreshold: number): StreamingSession {
    this.expireOldSessions();
    if (this.sessions.size >= this.limits.maxActiveSessions) throw new Error("STREAM_CAPACITY_REACHED");
    if (!this.transcriptionService.availableProviders().includes("whisper-large-v3-turbo")) throw new Error("TRANSCRIPTION_NOT_CONFIGURED");

    const threshold = Number.isFinite(speechThreshold) ? Math.min(0.15, Math.max(0.025, speechThreshold)) : 0.025;
    const vadConfig = { ...this.config, maxDurationMs: this.limits.maxDurationMs, maxBytes: this.limits.maxBytes };
    const session: StreamingSession = {
      id: randomUUID(), chunks: [], bytes: 0, queuedBytes: 0, startedAt: this.now(), lastSequence: -1,
      samplesReceived: 0, lastWindowEndSample: 0, windowIndex: 0,
      vad: new VoiceActivityDetector({ ...vadConfig, speechThreshold: threshold, silenceThreshold: getSilenceThreshold(threshold) }),
      config: vadConfig, limits: this.limits, cancelled: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): StreamingSession | undefined {
    return this.sessions.get(id);
  }

  append(id: string, sequence: number, chunk: Buffer): StreamingSession {
    const session = this.sessions.get(id);
    if (!session || session.cancelled) throw new Error("STREAM_NOT_FOUND");
    if (sequence !== session.lastSequence + 1) throw new Error("INVALID_CHUNK_SEQUENCE");
    if (chunk.length === 0 || chunk.length % bytesPerSample !== 0) throw new Error("INVALID_PCM_FRAME");
    if (session.bytes + chunk.length > session.limits.maxBytes) throw new Error("STREAM_SIZE_LIMIT");
    const nextBytes = session.bytes + chunk.length;
    const nextDurationMs = nextBytes / (pcmSampleRate * bytesPerSample) * 1_000;
    if (nextDurationMs > session.limits.maxDurationMs) throw new Error("STREAM_DURATION_LIMIT");
    if (session.queuedBytes + chunk.length > session.limits.maxQueueBytes) throw new Error("STREAM_QUEUE_LIMIT");

    session.lastSequence = sequence;
    session.bytes = nextBytes;
    session.queuedBytes += chunk.length;
    session.samplesReceived += chunk.length / bytesPerSample;
    session.chunks.push(chunk);
    return session;
  }

  takeNextWindow(id: string, flush = false): AudioWindow | null {
    const session = this.sessions.get(id);
    if (!session || session.cancelled) throw new Error("STREAM_NOT_FOUND");
    const nextEnd = session.lastWindowEndSample === 0 ? windowSamples : session.lastWindowEndSample + windowStepSamples;
    if (!flush && session.samplesReceived < nextEnd) return null;
    if (flush && session.samplesReceived <= session.lastWindowEndSample) return null;

    const endSample = Math.min(session.samplesReceived, nextEnd);
    const startSample = session.lastWindowEndSample === 0 ? 0 : Math.max(0, session.lastWindowEndSample - overlapSamples);
    const audio = Buffer.concat(session.chunks, session.bytes);
    const pcm = audio.subarray(startSample * bytesPerSample, endSample * bytesPerSample);
    const newlyCoveredBytes = (endSample - session.lastWindowEndSample) * bytesPerSample;
    session.queuedBytes = Math.max(0, session.queuedBytes - newlyCoveredBytes);
    session.lastWindowEndSample = endSample;
    session.windowIndex += 1;
    return {
      index: session.windowIndex,
      startSample,
      endSample,
      durationMs: (endSample - startSample) / pcmSampleRate * 1_000,
      pcm,
    };
  }

  finish(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.chunks.length = 0;
    session.bytes = 0;
    session.queuedBytes = 0;
    return this.sessions.delete(id);
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.cancelled = true;
    session.chunks.length = 0;
    session.bytes = 0;
    session.queuedBytes = 0;
    return this.sessions.delete(id);
  }

  private expireOldSessions(): void {
    const expirationMs = 240_000;
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now - session.startedAt > expirationMs) this.cancel(id);
    }
  }
}
