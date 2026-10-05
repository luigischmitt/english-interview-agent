/** `silenceStartedAt` (epoch ms): when the local VAD pause was detected; lets the caller time grace and prepare from the pause, not from text arrival. */
export type TurnEndInfo = { silenceStartedAt?: number };

/** Fixed content-free failure category of a streaming session. */
export type StreamFailureReason = "segment_failed";

/**
 * The part of a streaming session the stream WebSocket uses. `IncrementalWhisperSession` (OpenRouter Whisper on VAD-cut
 * segments) implements it; the WebSocket runs one orchestration path (answer grace, answer-provisional, semantic end,
 * captions) on top of it.
 */
export interface StreamingTurnSession {
  readonly failed: boolean;
  readonly failureReason: StreamFailureReason | null;
  /** Content-free reason the session was abandoned (for the fallback log); null while healthy. */
  readonly failureDetail?: string | null;
  readonly turnCount: number;
  readonly turnActive: boolean;
  setTurnObserver(observer: ((kind: "start" | "end", transcript: string) => void) | null): void;
  open(): void;
  sendAudio(frame: Buffer): void;
  /** Level (RMS) of the 100 ms frame that was just received. */
  recordLevel?(level: number): void;
  markSpeech(): void;
  endTurn(timeoutMs: number): Promise<void>;
  transcript(): string;
  committedText(): string;
  partialText(): string;
  flush(timeoutMs: number): Promise<string>;
  close(): void;
  /** Content-free counters for the `complete` diagnostic. */
  diagnostics?(): Record<string, number>;
}
