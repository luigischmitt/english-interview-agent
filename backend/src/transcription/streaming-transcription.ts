import { randomUUID } from "node:crypto";

import { defaultVadConfig, getSilenceThreshold, VoiceActivityDetector, type VadConfig } from "./voice-activity-detector.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";

export type StreamingSession = {
  id: string;
  chunks: Buffer[];
  bytes: number;
  startedAt: number;
  lastSequence: number;
  mimeType: "audio/webm" | "audio/mp4";
  vad: VoiceActivityDetector;
  config: VadConfig;
};

export class StreamingTranscriptionSessions {
  private readonly sessions = new Map<string, StreamingSession>();

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly now: () => number = Date.now,
    private readonly config: VadConfig = defaultVadConfig,
    private readonly maxActiveSessions = 16,
  ) {}

  create(mimeType: string, speechThreshold: number): StreamingSession {
    this.expireOldSessions();
    if (this.sessions.size >= this.maxActiveSessions) throw new Error("STREAM_CAPACITY_REACHED");
    if (!this.transcriptionService.availableProviders().includes("whisper-large-v3-turbo")) throw new Error("TRANSCRIPTION_NOT_CONFIGURED");
    if (mimeType !== "audio/webm" && mimeType !== "audio/mp4") throw new Error("UNSUPPORTED_AUDIO_FORMAT");

    const threshold = Number.isFinite(speechThreshold) ? Math.min(0.15, Math.max(0.025, speechThreshold)) : 0.025;
    const session: StreamingSession = {
      id: randomUUID(), chunks: [], bytes: 0, startedAt: this.now(), lastSequence: -1,
      mimeType, vad: new VoiceActivityDetector({ ...this.config, speechThreshold: threshold, silenceThreshold: getSilenceThreshold(threshold) }), config: this.config,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): StreamingSession | undefined {
    return this.sessions.get(id);
  }

  append(id: string, sequence: number, chunk: Buffer): StreamingSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error("STREAM_NOT_FOUND");
    if (sequence !== session.lastSequence + 1) throw new Error("INVALID_CHUNK_SEQUENCE");
    // The final MediaRecorder slice can arrive just after the client's 30 s stop timer.
    if (this.now() - session.startedAt > session.config.maxDurationMs + 1_000) throw new Error("STREAM_DURATION_LIMIT");
    if (chunk.length === 0 || session.bytes + chunk.length > session.config.maxBytes) throw new Error("STREAM_SIZE_LIMIT");
    session.lastSequence = sequence;
    session.bytes += chunk.length;
    session.chunks.push(chunk);
    return session;
  }

  async finalize(id: string): Promise<TranscriptionResult> {
    const session = this.sessions.get(id);
    if (!session) throw new Error("STREAM_NOT_FOUND");
    if (!session.vad.hasSpeech || session.vad.speechDurationMs < session.config.minimumSpeechMs || session.bytes === 0) {
      this.sessions.delete(id);
      throw new Error("STREAM_TOO_SHORT");
    }
    this.sessions.delete(id);
    const audio = Buffer.concat(session.chunks, session.bytes);
    session.chunks.length = 0;
    return this.transcriptionService.transcribe(audio, "whisper-large-v3-turbo", session.mimeType === "audio/webm" ? "webm" : "mp4");
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.chunks.length = 0;
    return this.sessions.delete(id);
  }

  private expireOldSessions(): void {
    const expirationMs = 60_000;
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now - session.startedAt > expirationMs) this.cancel(id);
    }
  }
}
