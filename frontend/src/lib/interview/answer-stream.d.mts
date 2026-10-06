export class StreamSetupError extends Error {
  constructor(code?: string);
  readonly code?: string;
  readonly kind: "setup";
}
export class StreamConnectionError extends Error {
  constructor(kind: "timeout" | "connection");
  readonly kind: "timeout" | "connection";
}

export type AnswerStreamSocket = {
  binaryType: string;
  readyState: number;
  bufferedAmount: number;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
};

export type AnswerStreamState = "idle" | "connecting" | "ready" | "streaming" | "failed" | "closed";
export type AnswerStreamFailure = "closed" | "slow" | "buffer";

export type AnswerStreamOptions = {
  openSocket: () => AnswerStreamSocket;
  /** Builds the `start` message (fresh access token, threshold, ...). May throw (e.g. StreamSetupError). */
  buildStartMessage: () => Promise<unknown>;
  encodeFrame: (samples: Float32Array) => ArrayBuffer;
  /** Every server message after `ready`, once the audio gate is open. */
  onMessage?: (message: Record<string, unknown> & { type?: string }, socket: AnswerStreamSocket) => void;
  /** Socket closed after the gate opened (the owner decides what that means). */
  onClose?: (event: { code?: number }, socket: AnswerStreamSocket) => void;
  onFailure?: (reason: AnswerStreamFailure) => void;
  readyTimeoutMs?: number;
  maxBufferedFrames?: number;
  maxSocketBufferBytes?: number;
  setTimeout?: (callback: () => void, delay: number) => unknown;
  clearTimeout?: (id: unknown) => void;
};

export type AnswerStream = {
  readonly state: AnswerStreamState;
  readonly socket: AnswerStreamSocket | null;
  readonly readyMessage: (Record<string, unknown> & { features?: { pronunciationAssessment?: boolean } }) | null;
  readonly gateOpen: boolean;
  connect(): Promise<Record<string, unknown>>;
  begin(): Promise<{ preconnected: boolean; readyMessage: AnswerStream["readyMessage"] }>;
  pushFrame(frame: { samples: Float32Array; level: number }): void;
  sendControl(message: Record<string, unknown>): boolean;
  cancel(): void;
  release(): void;
};

export const defaultReadyTimeoutMs: number;
export const defaultMaxBufferedFrames: number;
export const defaultMaxSocketBufferBytes: number;
export function createAnswerStream(options: AnswerStreamOptions): AnswerStream;
