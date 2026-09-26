import { randomUUID } from "node:crypto";

import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector, type VadConfig } from "./voice-activity-detector.js";
import type { TranscriptionService } from "./types.js";

export const pcmSampleRate = 16_000;
const bytesPerSample = 2;

export type StreamingLimits = {
  maxDurationMs: number;
  maxBytes: number;
  maxActiveSessions: number;
  maxConcurrentTranscriptions: number;
  maxQueuedTranscriptions: number;
  finalizationTimeoutMs: number;
};

export const defaultStreamingLimits: StreamingLimits = {
  maxDurationMs: 180_000,
  maxBytes: 6 * 1024 * 1024,
  maxActiveSessions: 8,
  maxConcurrentTranscriptions: 4,
  maxQueuedTranscriptions: 4,
  finalizationTimeoutMs: 128_000,
};

export type StreamingSession = {
  id: string;
  chunks: Buffer[];
  bytes: number;
  startedAt: number;
  lastSequence: number;
  vad: VoiceActivityDetector;
  config: VadConfig;
  limits: StreamingLimits;
  cancelled: boolean;
};

/** Builds a WAV directly from the received frames, avoiding an intermediate full-size PCM copy. */
export function pcmChunksToWav(chunks: Buffer[], pcmLength: number): Buffer {
  const wav = Buffer.allocUnsafe(44 + pcmLength);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmLength, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(pcmSampleRate, 24);
  wav.writeUInt32LE(pcmSampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmLength, 40);
  let offset = 44;
  for (const chunk of chunks) {
    chunk.copy(wav, offset);
    offset += chunk.length;
  }
  return wav;
}

export function pcmToWav(pcm: Buffer): Buffer {
  return pcmChunksToWav([pcm], pcm.length);
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
      id: randomUUID(), chunks: [], bytes: 0, startedAt: this.now(), lastSequence: -1,
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
    const nextDurationMs = (session.bytes + chunk.length) / (pcmSampleRate * bytesPerSample) * 1_000;
    if (nextDurationMs > session.limits.maxDurationMs) throw new Error("STREAM_DURATION_LIMIT");

    session.lastSequence = sequence;
    session.bytes += chunk.length;
    session.chunks.push(chunk);
    return session;
  }

  toWav(id: string): Buffer {
    const session = this.sessions.get(id);
    if (!session || session.cancelled) throw new Error("STREAM_NOT_FOUND");
    return pcmChunksToWav(session.chunks, session.bytes);
  }

  finish(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.releaseBuffers(session);
    return this.sessions.delete(id);
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.cancelled = true;
    this.releaseBuffers(session);
    return this.sessions.delete(id);
  }

  private releaseBuffers(session: StreamingSession): void {
    for (const chunk of session.chunks) chunk.fill(0);
    session.chunks.length = 0;
    session.bytes = 0;
  }

  private expireOldSessions(): void {
    const expirationMs = 240_000;
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now - session.startedAt > expirationMs) this.cancel(id);
    }
  }
}

type QueueJob = {
  id: string;
  task: () => Promise<void>;
  onQueued: () => void;
  onCancel: () => void;
};

/** A process-wide bounded FIFO for finalized Whisper calls. */
export class FinalTranscriptionQueue {
  private readonly pending: QueueJob[] = [];
  private readonly knownJobs = new Map<string, QueueJob>();
  private active = 0;

  constructor(private readonly maxConcurrent: number, private readonly maxQueued: number) {}

  get activeCount(): number { return this.active; }
  get queuedCount(): number { return this.pending.length; }

  enqueue(id: string, task: () => Promise<void>, onQueued: () => void, onCancel: () => void = () => undefined): void {
    if (this.knownJobs.has(id)) throw new Error("TRANSCRIPTION_ALREADY_QUEUED");
    const job = { id, task, onQueued, onCancel };
    if (this.active < this.maxConcurrent) {
      this.knownJobs.set(id, job);
      this.start(job);
      return;
    }
    if (this.pending.length >= this.maxQueued) throw new Error("TRANSCRIPTION_CAPACITY_REACHED");
    this.knownJobs.set(id, job);
    this.pending.push(job);
    onQueued();
  }

  cancel(id: string): void {
    const job = this.knownJobs.get(id);
    if (!job) return;
    const index = this.pending.indexOf(job);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.knownJobs.delete(id);
      this.drain();
      return;
    }
    job.onCancel();
  }

  private start(job: QueueJob): void {
    this.active += 1;
    void job.task().catch(() => undefined).finally(() => {
      this.active -= 1;
      this.knownJobs.delete(job.id);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift()!;
      if (this.knownJobs.has(next.id)) this.start(next);
    }
  }
}
