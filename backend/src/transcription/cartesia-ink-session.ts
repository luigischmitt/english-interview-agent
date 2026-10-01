import WebSocket from "ws";

/**
 * Minimal client for Cartesia streaming speech-to-text: Ink-2 (turn-based WebSocket, default) or Ink-Whisper
 * (segment WebSocket, cheaper; turn ends come from the caller through `endTurn`).
 *
 * Privacy: audio is forwarded as it arrives and never stored here; neither transcripts, keyterms nor the API key are logged.
 * The API key is only ever sent as a request header to Cartesia.
 */

export const cartesiaInkEndpoint = "wss://api.cartesia.ai/stt/turns/websocket";
export const cartesiaInkWhisperEndpoint = "wss://api.cartesia.ai/stt/websocket";
export const cartesiaVersion = "2026-03-01";
export const maxKeyterms = 30;
export const maxKeytermLength = 40;
const maxPendingBytes = 8 * 1024 * 1024;

type WebSocketConstructor = new (url: string, options?: { headers?: Record<string, string> }) => WebSocket;

export type CartesiaModel = "ink-2" | "ink-whisper";

export type CartesiaInkOptions = {
  apiKey: string;
  /** `ink-2` (default) or `ink-whisper`; Ink-Whisper has no turn events, no keyterms and uses a different endpoint. */
  model?: CartesiaModel;
  keyterms?: string[];
  /** Optional Ink-2 turn_end_timeout_ms (640-11200). */
  turnEndTimeoutMs?: number | null;
  endpoint?: string;
  WebSocketImpl?: WebSocketConstructor;
  /** Maximum time to wait for the `connected` message (Ink-Whisper: the socket opening) before treating the session as failed. */
  openTimeoutMs?: number;
  onTurnStart?: () => void;
  /** Called after each `turn.end` (Ink-Whisper: after each local `endTurn`) with that turn's final transcript. */
  onTurnEnd?: (transcript: string) => void;
  /** Called whenever the live caption text (finished turns or the current partial turn) may have changed. Display-only. */
  onCaptionChange?: () => void;
  /** Called once, with a fixed content-free reason, when the connection fails or the server reports an error. */
  onFailure?: (reason: CartesiaFailureReason) => void;
};

export type CartesiaFailureReason = "open_timeout" | "connection_error" | "connection_closed" | "provider_error";

/** Keeps only plausible short terms; returns null when the whole list is unusable (not an array or too many terms). */
export function sanitizeKeyterms(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > maxKeyterms) return null;
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.replace(/\s+/g, " ").trim();
    // eslint-disable-next-line no-control-regex
    if (!term || term.length > maxKeytermLength || /[\u0000-\u001f\u007f]/.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

export function buildCartesiaInkUrl(options: Pick<CartesiaInkOptions, "endpoint" | "keyterms" | "turnEndTimeoutMs" | "model">): string {
  if (options.model === "ink-whisper") {
    // Ink-Whisper rejects the turns endpoint and does not support keyterms or a turn timeout.
    return `${options.endpoint ?? cartesiaInkWhisperEndpoint}?model=ink-whisper&encoding=pcm_s16le&sample_rate=16000&language=en`;
  }
  const parts = ["model=ink-2", "encoding=pcm_s16le", "sample_rate=16000"];
  if (options.turnEndTimeoutMs) parts.push(`turn_end_timeout_ms=${Math.round(options.turnEndTimeoutMs)}`);
  // encodeURIComponent writes spaces as %20, which Cartesia requires (a "+" would be taken literally).
  for (const term of options.keyterms ?? []) parts.push(`keyterm=${encodeURIComponent(term)}`);
  return `${options.endpoint ?? cartesiaInkEndpoint}?${parts.join("&")}`;
}

export class CartesiaInkSession {
  private socket: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private failedReason: CartesiaFailureReason | null = null;
  private closeRequested = false;
  private closeSent = false;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private finals: string[] = [];
  private partial = "";
  private activeTurn = false;
  private turnEnds = 0;
  private lastTurnEndAt = 0;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private terminateTimer: ReturnType<typeof setTimeout> | null = null;
  private settleWaiters: Array<() => void> = [];
  // Ink-Whisper local turn bookkeeping.
  private turnStartIndex = 0;
  private endTurnWaiter: (() => void) | null = null;
  private speechDuringEndTurn = false;

  private turnObserver: ((kind: "start" | "end", transcript: string) => void) | null = null;

  constructor(private readonly options: CartesiaInkOptions) {}

  /** Observes turn boundaries (arrival time of `turn.start` / `turn.end`); used to place Azure assessment blocks. */
  setTurnObserver(observer: ((kind: "start" | "end", transcript: string) => void) | null): void {
    this.turnObserver = observer;
  }

  get failed(): boolean { return this.failedReason !== null; }
  get failureReason(): CartesiaFailureReason | null { return this.failedReason; }
  get turnCount(): number { return this.turnEnds; }
  get turnActive(): boolean { return this.activeTurn; }
  private get inkWhisper(): boolean { return this.options.model === "ink-whisper"; }
  private get alive(): boolean { return !this.closed && !this.failed && !this.closeRequested; }

  /** Ink-Whisper only: marks speech activity so `turnActive` mirrors an Ink-2 turn in progress until the next local turn end. */
  markSpeech(): void {
    if (!this.inkWhisper || !this.alive) return;
    this.speechDuringEndTurn = true;
    if (this.activeTurn) return;
    this.activeTurn = true;
    this.turnObserver?.("start", "");
    this.options.onTurnStart?.();
  }

  /**
   * Ink-Whisper only: asks the server to finalize pending audio (text `finalize`), waits for `flush_done` (bounded by
   * `timeoutMs`) and then registers a local turn end with the segments finalized since the previous one. If speech
   * resumed meanwhile, no turn end is registered and those segments roll into the next one.
   */
  async endTurn(timeoutMs: number): Promise<void> {
    if (!this.inkWhisper || !this.alive || !this.connected || this.endTurnWaiter || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.speechDuringEndTurn = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.endTurnWaiter = done;
      this.socket!.send("finalize");
    });
    this.endTurnWaiter = null;
    if (!this.alive || this.speechDuringEndTurn) return;
    const turnText = this.finals.slice(this.turnStartIndex).join(" ").replace(/\s+/g, " ").trim();
    this.turnStartIndex = this.finals.length;
    this.activeTurn = false;
    this.turnEnds += 1;
    this.lastTurnEndAt = Date.now();
    this.turnObserver?.("end", turnText);
    this.options.onCaptionChange?.();
    this.options.onTurnEnd?.(turnText);
  }

  /** Accumulated answer transcript: every finished turn in order, plus the latest unfinished turn if any. */
  transcript(): string {
    return [...this.finals, this.activeTurn ? this.partial : ""].join(" ").replace(/\s+/g, " ").trim();
  }

  /** Finished turns joined in order (display-only caption text). */
  committedText(): string {
    return this.finals.join(" ").replace(/\s+/g, " ").trim();
  }

  /** Latest text of the turn in progress; empty once that turn ended (display-only caption text). */
  partialText(): string {
    return (this.activeTurn ? this.partial : "").replace(/\s+/g, " ").trim();
  }

  open(): void {
    if (this.socket || this.closed) return;
    const Impl = this.options.WebSocketImpl ?? (WebSocket as unknown as WebSocketConstructor);
    try {
      this.socket = new Impl(buildCartesiaInkUrl(this.options), {
        headers: { "X-API-Key": this.options.apiKey, "Cartesia-Version": cartesiaVersion },
      });
    } catch {
      this.fail("connection_error");
      return;
    }
    const socket = this.socket;
    this.openTimer = setTimeout(() => this.fail("open_timeout"), this.options.openTimeoutMs ?? 5_000);
    // Ink-Whisper sends no `connected` message: an open socket is ready.
    if (this.inkWhisper) socket.on("open", () => this.markConnected());
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.handleMessage(data.toString());
    });
    socket.on("error", () => this.fail("connection_error"));
    socket.on("close", () => {
      this.closed = true;
      if (!this.connected && !this.failed) this.fail("connection_closed");
      else if (this.connected && !this.closeRequested && !this.failed) this.markFailed("connection_closed");
      this.cleanupTimers();
      if (this.terminateTimer) clearTimeout(this.terminateTimer);
      this.settle();
      this.endTurnWaiter?.();
    });
  }

  /** Sends a PCM s16le 16 kHz mono frame; frames sent before the connection is ready are queued (bounded). */
  sendAudio(frame: Buffer): void {
    if (this.closed || this.failed || this.closeRequested) return;
    const copy = Buffer.from(frame);
    if (!this.connected) {
      if (this.pendingBytes + copy.length > maxPendingBytes) return this.fail("connection_error");
      this.pending.push(copy);
      this.pendingBytes += copy.length;
      return;
    }
    this.socket?.send(copy);
  }

  /**
   * Asks Ink-2 to flush and finish, then resolves with the accumulated transcript. Resolves early when no turn is
   * in progress and the last turn ended a while ago; otherwise waits for the server to close, bounded by `timeoutMs`.
   * Ink-Whisper (text `close`, acknowledged by `done`) always waits: trailing audio may hold words never finalized.
   */
  flush(timeoutMs: number): Promise<string> {
    if (this.closed || this.failed) {
      this.destroy();
      return Promise.resolve(this.transcript());
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) clearTimeout(timer);
        const index = this.settleWaiters.indexOf(done);
        if (index >= 0) this.settleWaiters.splice(index, 1);
        const text = this.transcript();
        this.destroy();
        resolve(text);
      };
      this.settleWaiters.push(done);
      timer = setTimeout(done, timeoutMs);
      this.closeRequested = true;
      if (this.connected) {
        this.sendClose();
        if (!this.inkWhisper && !this.activeTurn && Date.now() - this.lastTurnEndAt >= 500) done();
      }
    });
  }

  /** Hard stop: drops queued audio and the socket without waiting. Safe to call repeatedly. */
  close(): void {
    this.closeRequested = true;
    this.destroy();
    this.settle();
  }

  private destroy(): void {
    this.cleanupTimers();
    for (const frame of this.pending) frame.fill(0);
    this.pending = [];
    this.pendingBytes = 0;
    const socket = this.socket;
    this.closed = true;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN && !this.failed && this.closeSent) {
      // The close request was delivered; let the server finish, but never keep the socket longer than a second.
      this.terminateTimer = setTimeout(() => socket.terminate(), 1_000);
      this.terminateTimer.unref?.();
    } else if (socket.readyState === WebSocket.CONNECTING) {
      socket.once("error", () => undefined);
      socket.terminate();
    } else if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
  }

  private cleanupTimers(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private settle(): void {
    for (const waiter of [...this.settleWaiters]) waiter();
  }

  private sendClose(): void {
    if (this.closeSent || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.closeSent = true;
    this.socket.send(this.inkWhisper ? "close" : JSON.stringify({ type: "close" }));
  }

  private markFailed(reason: CartesiaFailureReason): void {
    if (this.failedReason) return;
    this.failedReason = reason;
    this.options.onFailure?.(reason);
  }

  private fail(reason: CartesiaFailureReason): void {
    this.markFailed(reason);
    this.cleanupTimers();
    this.destroy();
    this.settle();
    this.endTurnWaiter?.();
  }

  private markConnected(): void {
    if (this.connected || this.closed) return;
    this.connected = true;
    this.cleanupTimers();
    for (const frame of this.pending) this.socket?.send(frame);
    this.pending = [];
    this.pendingBytes = 0;
    if (this.closeRequested) this.sendClose();
  }

  private handleMessage(raw: string): void {
    let message: { type?: unknown; transcript?: unknown; text?: unknown; is_final?: unknown };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }
    const text = typeof message.transcript === "string" ? message.transcript : "";
    switch (message.type) {
      case "connected":
        this.markConnected();
        break;
      case "transcript": {
        // Ink-Whisper: final segments only; a segment is not a turn end (the caller decides those through `endTurn`).
        if (!this.inkWhisper || message.is_final !== true || typeof message.text !== "string") break;
        const segment = message.text.trim();
        if (!segment) break;
        this.finals.push(segment);
        this.options.onCaptionChange?.();
        break;
      }
      case "flush_done":
        this.endTurnWaiter?.();
        break;
      case "done":
        if (this.inkWhisper) this.settle();
        break;
      case "turn.start":
        this.activeTurn = true;
        this.partial = "";
        this.turnObserver?.("start", "");
        this.options.onTurnStart?.();
        break;
      case "turn.update":
      case "turn.eager_end":
        this.activeTurn = true;
        this.partial = text;
        this.options.onCaptionChange?.();
        break;
      case "turn.end": {
        const finalText = text.trim();
        if (finalText) this.finals.push(finalText);
        this.partial = "";
        this.activeTurn = false;
        this.turnEnds += 1;
        this.lastTurnEndAt = Date.now();
        this.turnObserver?.("end", finalText);
        this.options.onCaptionChange?.();
        this.options.onTurnEnd?.(finalText);
        break;
      }
      case "error":
        this.fail("provider_error");
        break;
      default:
        break;
    }
  }
}
