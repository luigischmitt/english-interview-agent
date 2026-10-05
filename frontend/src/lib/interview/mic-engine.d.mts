export type MicEngineState = "idle" | "acquiring" | "ready" | "failed";
export type MicFrame = { samples: Float32Array; level: number };
export type MicLostReason = "ended" | "muted";

export type MicEngineDeps = {
  isSupported: () => boolean;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  workletUrl: string;
  stopTracks: (stream: MediaStream | null | undefined) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Declares the audio session before the microphone opens / after it is released (iOS Audio Session API). */
  prepareSession?: () => void;
  restoreSession?: () => void;
  /** Content-free mic_open / mic_close / audio_session diagnostics. */
  onDiagnostic?: (event: { kind: string; [field: string]: unknown }) => void;
  /** The chosen input device could not be opened and the default input is being used instead. */
  onDeviceFallback?: () => void;
  /** Content-free recovery diagnostics (reason only). */
  onRecovered?: (reason: string) => void;
};

export type MicEngine = {
  readonly state: MicEngineState;
  readonly error: unknown;
  /** Speech threshold for the stream `start` message: the calibrated noise floor, or the conservative default. */
  readonly noiseFloor: number;
  readonly calibrated: boolean;
  readonly capturing: boolean;
  /** The chosen input device id, or null for the browser default. */
  readonly deviceId: string | null;
  /** Chooses the device for the next acquisition; follow with ensureHealthy({ force: true }) to reopen now. */
  setDeviceId(deviceId: string | null): void;
  acquire(): Promise<void>;
  isHealthy(): boolean;
  /** Resumes a suspended/interrupted AudioContext (rebuilding the graph if it will not run). No wait when running. */
  ensureRunning(): Promise<boolean>;
  ensureHealthy(options?: { force?: boolean }): Promise<boolean>;
  calibrate(options?: { keepFrames?: boolean; frames?: number; timeoutMs?: number }): Promise<number | null>;
  beginInterviewerSpeech(): void;
  startCapture(sink: (frame: MicFrame) => void, options?: { replayHeld?: boolean }): void;
  stopCapture(): void;
  flush(): Promise<void>;
  on(event: "state", listener: (state: MicEngineState) => void): () => void;
  on(event: "lost", listener: (reason: MicLostReason) => void): () => void;
  release(): void;
};

export const calibrationFrameCount: number;
export const defaultSpeechThreshold: number;
export function rootMeanSquare(samples: Float32Array): number;
export function createBrowserMicDeps(options?: { onDiagnostic?: MicEngineDeps["onDiagnostic"]; onDeviceFallback?: () => void }): MicEngineDeps;
export function createMicEngine(deps: MicEngineDeps, options?: { deviceId?: string | null }): MicEngine;
