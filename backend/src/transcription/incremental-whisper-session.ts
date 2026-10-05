import { TranscriptionUnavailableError } from "./errors.js";
import type { StreamFailureReason, StreamingTurnSession, TurnEndInfo } from "./streaming-turn-session.js";
import { pcmToWav } from "./streaming-transcription.js";
import { hedgedTranscribe } from "./hedged-transcription.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";

/**
 * Incremental Whisper: the answer is cut at local VAD pauses (and every ~15 s of continuous speech) and each segment is
 * transcribed in the background with OpenRouter Whisper while the candidate keeps talking, so the transcript is almost
 * ready when the answer ends. It implements `StreamingTurnSession` (the local VAD drives `markSpeech`/`endTurn`) and the
 * WebSocket runs the answer orchestration (grace, provisional answer, semantic end, captions) on top of it.
 *
 * Privacy: PCM stays in memory, every buffer (copies, segment audio, WAVs) is zeroed after use, and neither audio nor text
 * is logged here. `diagnostics()` returns counters only.
 *
 * Each segment request carries Whisper vocabulary context: the interviewer question and the tail of the transcript so far.
 */

const bytesPerMs = 32; // 16 kHz s16le mono
const frameMs = 100;

export type IncrementalWhisperOptions = {
  service: TranscriptionService;
  /** Speech threshold of the VAD (RMS level); frames at or above it count as speech. */
  speechThreshold: number;
  /** Per-segment Whisper time limit (one attempt group, hedge included). A failed group is retried once. Default 8000. */
  segmentTimeoutMs?: number;
  /** A segment request still pending after this long is raced against an identical second request (first success wins). 0 disables. Default 2500. */
  segmentHedgeAfterMs?: number;
  /** Hedge delay for a segment on the critical path (the tail cut at the end-of-answer pause or at finalization). Default 1500; 0 disables. */
  tailHedgeAfterMs?: number;
  /** Pause (consecutive quiet frames) that cuts a long buffered segment early, without ending the turn. 0 disables. Default 400. */
  softCutSilenceMs?: number;
  /** A soft cut only happens once at least this much audio is buffered, so the tail after the last cut stays short. Default 6000. */
  softCutMinBufferedMs?: number;
  /** Longest continuous segment before a forced cut at the quietest recent frame. Default 15000. */
  maxSegmentMs?: number;
  /** Segments with less speech than this are not transcribed. Default 300. */
  minSegmentSpeechMs?: number;
  /** Window (at the end of a long segment) searched for the quietest frame. Default 3000. */
  forcedCutWindowMs?: number;
  /** Interviewer question of this answer, used only as Whisper vocabulary context (never logged). */
  question?: string | null;
  /** Test hook. */
  now?: () => number;
  onTurnStart?: () => void;
  onTurnEnd?: (transcript: string, info?: TurnEndInfo) => void;
  onCaptionChange?: () => void;
  onFailure?: (reason: StreamFailureReason, detail: SessionFailureDetail) => void;
};

/** Phrases Whisper tends to invent on near-silence; dropped only when the segment had little speech. */
const hallucinations = new Set(["you", "thank you", "thanks", "thanks for watching", "thank you for watching", "bye", "bye bye", "the end"]);
const hallucinationSpeechMs = 1_200;

/** Content-free reason the incremental session was abandoned (the caller then transcribes the full audio). */
export type SessionFailureDetail = "segment_error" | "segment_timeout" | "flush_timeout";

function normalizeForGuard(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

type Segment = {
  state: "pending" | "done" | "skipped" | "failed";
  text: string;
  /** Set only for segments cut by a pause (`endTurn`); forced cuts never signal a turn end. */
  turnEnd: boolean;
  /** Speech epoch at the cut: if it changed before the segment completes, speech resumed and no turn end is signalled. */
  epoch: number;
  /** When the pause that cut this segment was detected (epoch ms). */
  cutAt: number;
  promise: Promise<void> | null;
};

export class IncrementalWhisperSession implements StreamingTurnSession {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private levels: number[] = [];
  private segments: Segment[] = [];
  private committed = 0;
  private finals: string[] = [];
  private activeTurn = false;
  private turnEnds = 0;
  private speechEpoch = 0;
  private closed = false;
  private flushing = false;
  private failedReason: StreamFailureReason | null = null;
  private readonly controller = new AbortController();
  private readonly waiters = new Set<() => void>();
  private turnObserver: ((kind: "start" | "end", transcript: string) => void) | null = null;
  private stats = { segmentsTranscribed: 0, segmentsSkipped: 0, tailMs: 0, maxSegmentLatencyMs: 0, segmentHedges: 0, segmentHedgeWins: 0, segmentRetries: 0, softCuts: 0, tailStartedAtSilence: 0 };
  private quietFrames = 0;
  private softCutPending = false;
  private detail: SessionFailureDetail | null = null;

  constructor(private readonly options: IncrementalWhisperOptions) {}

  setTurnObserver(observer: ((kind: "start" | "end", transcript: string) => void) | null): void {
    this.turnObserver = observer;
  }

  get failed(): boolean { return this.failedReason !== null; }
  /** Why the session gave up (content-free); null while it is healthy. */
  get failureDetail(): SessionFailureDetail | null { return this.detail; }
  get failureReason(): StreamFailureReason | null { return this.failedReason; }
  get turnCount(): number { return this.turnEnds; }
  get turnActive(): boolean { return this.activeTurn; }
  private get alive(): boolean { return !this.closed && !this.failed; }
  private get now(): number { return (this.options.now ?? Date.now)(); }

  /** Nothing to connect: segments are transcribed through the shared Whisper service. */
  open(): void {}

  diagnostics(): Record<string, number> {
    return { ...this.stats };
  }

  markSpeech(): void {
    if (!this.alive || this.flushing) return;
    this.speechEpoch += 1;
    this.softCutPending = false;
    if (this.activeTurn) return;
    this.activeTurn = true;
    this.turnObserver?.("start", "");
    this.options.onTurnStart?.();
  }

  recordLevel(level: number): void {
    if (!this.alive || this.flushing || !Number.isFinite(level)) return;
    this.levels.push(level);
    this.quietFrames = level >= this.options.speechThreshold ? 0 : this.quietFrames + 1;
    this.softCut();
  }

  sendAudio(frame: Buffer): void {
    if (!this.alive || this.flushing) return;
    this.chunks.push(Buffer.from(frame));
    this.bytes += frame.length;
    if (this.bytes >= (this.options.maxSegmentMs ?? 15_000) * bytesPerMs) this.forcedCut();
  }

  /** Pause detected by the local VAD: cut the pending segment, transcribe it and signal the turn end when it is ready. */
  async endTurn(_timeoutMs: number): Promise<void> {
    if (!this.alive || this.flushing) return;
    if (this.bytes === 0) {
      // A soft cut already took everything up to this pause: the turn ends once the segments before it are committed.
      if (this.softCutPending && this.activeTurn) {
        this.softCutPending = false;
        this.segments.push({ state: "skipped", text: "", turnEnd: true, epoch: this.speechEpoch, cutAt: Date.now(), promise: null });
        this.drain();
      }
      return;
    }
    const segment = this.cut(this.bytes, this.levels.length, true);
    // The tail starts transcribing at the pause itself, not at finalization.
    if (segment?.promise) this.stats.tailStartedAtSilence = 1;
    if (segment?.promise) await segment.promise;
  }

  /** Ordered text of the segments completed so far (up to the first one still in flight). */
  transcript(): string {
    return this.joined();
  }

  committedText(): string {
    return this.joined();
  }

  partialText(): string {
    return "";
  }

  /**
   * Cuts the tail (when it holds speech), waits for every in-flight segment (bounded by `timeoutMs`) and resolves with the
   * ordered transcript. Any failed or unfinished segment resolves with "" so the caller transcribes the full audio instead.
   */
  async flush(timeoutMs: number): Promise<string> {
    if (this.closed) return "";
    this.flushing = true;
    if (this.alive && this.bytes > 0) {
      const tailBytes = this.bytes;
      const segment = this.cut(this.bytes, this.levels.length, false, true);
      if (segment && segment.state === "pending") this.stats.tailMs = Math.round(tailBytes / bytesPerMs);
    }
    const pending = this.segments.filter((segment) => segment.promise && segment.state === "pending").map((segment) => segment.promise!);
    if (pending.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
      const outcome = await Promise.race([Promise.all(pending).then(() => "done" as const), timedOut, this.waitClosed()]);
      clearTimeout(timer);
      if (outcome !== "done") this.markFailed("segment_failed", "flush_timeout");
    }
    const complete = this.alive && this.segments.every((segment) => segment.state === "done" || segment.state === "skipped");
    const text = complete ? this.joined() : "";
    this.close();
    return text;
  }

  /** Hard stop: aborts in-flight calls and zeroes all buffered audio. Safe to call repeatedly. */
  close(): void {
    this.closed = true;
    this.controller.abort();
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks = [];
    this.bytes = 0;
    this.levels = [];
    for (const waiter of [...this.waiters]) waiter();
  }

  private waitClosed(): Promise<"closed"> {
    return new Promise((resolve) => {
      if (this.closed) return resolve("closed");
      const waiter = () => { this.waiters.delete(waiter); resolve("closed"); };
      this.waiters.add(waiter);
    });
  }

  private joined(): string {
    return this.finals.join(" ").replace(/\s+/g, " ").trim();
  }

  private markFailed(reason: StreamFailureReason, detail: SessionFailureDetail): void {
    if (this.failedReason) return;
    this.failedReason = reason;
    this.detail = detail;
    this.options.onFailure?.(reason, detail);
  }

  /**
   * A short pause inside a long answer: cut what is buffered now (no turn end), so the segment that is still open when the
   * answer really ends is only the last sentence or two. Whisper latency grows with segment length.
   */
  private softCut(): void {
    const silenceMs = this.options.softCutSilenceMs ?? 400;
    if (silenceMs <= 0 || this.quietFrames * frameMs < silenceMs || !this.activeTurn) return;
    if (this.bytes < (this.options.softCutMinBufferedMs ?? 6_000) * bytesPerMs) return;
    this.stats.softCuts += 1;
    this.quietFrames = 0;
    this.softCutPending = true;
    this.cut(this.bytes, this.levels.length, false);
  }

  /** Continuous speech: cut at the quietest recent frame so the final tail stays short. No turn end is signalled. */
  private forcedCut(): void {
    const windowFrames = Math.max(1, Math.round((this.options.forcedCutWindowMs ?? 3_000) / frameMs));
    const total = this.levels.length;
    if (total === 0) {
      this.cut(this.bytes, 0, false);
      return;
    }
    let best = total - 1;
    for (let index = total - 1; index >= Math.max(0, total - windowFrames); index -= 1) {
      if (this.levels[index]! < this.levels[best]!) best = index;
    }
    // Cut in the middle of the quietest frame, mapping level indexes proportionally onto the audio.
    const offset = Math.floor(((best + 0.5) / total) * this.bytes / 2) * 2;
    this.cut(Math.max(2, Math.min(this.bytes, offset)), best + 1, false);
  }

  /** Moves the first `byteCount` bytes (and `levelCount` levels) into a new segment and starts transcribing it. */
  private cut(byteCount: number, levelCount: number, turnEnd: boolean, critical = turnEnd): Segment | null {
    if (byteCount <= 0) return null;
    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.bytes);
    const pcm = Buffer.from(all.subarray(0, byteCount));
    const rest = byteCount < this.bytes ? Buffer.from(all.subarray(byteCount)) : null;
    for (const chunk of this.chunks) chunk.fill(0);
    all.fill(0);
    this.chunks = rest ? [rest] : [];
    this.bytes = rest ? rest.length : 0;
    const levels = this.levels.slice(0, levelCount);
    this.levels = this.levels.slice(levelCount);

    const segment: Segment = { state: "pending", text: "", turnEnd, epoch: this.speechEpoch, cutAt: Date.now(), promise: null };
    this.segments.push(segment);

    // Speech inside the segment according to the local VAD levels; without levels the segment is transcribed to be safe.
    // A segment shorter than the minimum speech cannot hold enough speech either (levels can lag audio by a frame).
    const speechMs = pcm.length < (this.options.minSegmentSpeechMs ?? 300) * bytesPerMs ? 0
      : levels.length ? levels.filter((level) => level >= this.options.speechThreshold).length * frameMs : Number.POSITIVE_INFINITY;
    if (speechMs < (this.options.minSegmentSpeechMs ?? 300)) {
      pcm.fill(0);
      this.stats.segmentsSkipped += 1;
      segment.state = "skipped";
      this.drain();
      return segment;
    }
    segment.promise = this.transcribeSegment(segment, pcm, speechMs, critical);
    return segment;
  }

  /** The tail is on the critical path of the answer end, so it is hedged earlier than background segments (never later). */
  private tailHedgeAfterMs(): number {
    const regular = this.options.segmentHedgeAfterMs ?? 2_500;
    const tail = this.options.tailHedgeAfterMs ?? 1_500;
    return regular === 0 ? 0 : tail === 0 ? regular : Math.min(regular, tail);
  }

  /** One attempt group: a request raced against a hedge request after `segmentHedgeAfterMs`, limited to `segmentTimeoutMs`. */
  private requestSegment(wav: Buffer, critical: boolean): Promise<TranscriptionResult> {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.options.segmentTimeoutMs ?? 8_000)]);
    return hedgedTranscribe({
      start: async (callSignal) => {
        try {
          return await this.options.service.transcribe(wav, "whisper-large-v3-turbo", "wav", AbortSignal.any([signal, callSignal]), { question: this.options.question ?? null, previousText: this.joined() });
        } catch (error) {
          // An empty recognition is a result (nothing said), not a failure.
          if (error instanceof TranscriptionUnavailableError && error.providerStatus === "empty") return { provider: "whisper-large-v3-turbo", transcript: "" } as TranscriptionResult;
          throw error;
        }
      },
      hedgeAfterMs: critical ? this.tailHedgeAfterMs() : this.options.segmentHedgeAfterMs ?? 2_500,
      tryReserve: () => ({ active: true, release: () => undefined }),
      signal,
      onOutcome: (outcome) => {
        if (outcome === "primary_won" || outcome === "secondary_won" || outcome === "both_failed") this.stats.segmentHedges += 1;
        if (outcome === "secondary_won") this.stats.segmentHedgeWins += 1;
      },
    });
  }

  private async transcribeSegment(segment: Segment, pcm: Buffer, speechMs: number, critical: boolean): Promise<void> {
    const wav = pcmToWav(pcm);
    pcm.fill(0);
    const startedAt = this.now;
    try {
      let text = "";
      // A failed attempt group is retried once with the same audio (tail-only recovery: the rest of the answer is untouched),
      // instead of abandoning the whole incremental transcript for a full-audio call.
      for (let round = 0; ; round += 1) {
        try {
          text = (await this.requestSegment(wav, critical)).transcript.trim();
          break;
        } catch (error) {
          if (this.closed) return;
          const status = error instanceof TranscriptionUnavailableError ? error.providerStatus : undefined;
          if (round >= 1 || status === "rejected") throw error;
          this.stats.segmentRetries += 1;
        }
      }
      if (this.closed) return;
      this.stats.maxSegmentLatencyMs = Math.max(this.stats.maxSegmentLatencyMs, this.now - startedAt);
      const guard = normalizeForGuard(text);
      if (!guard || (speechMs < hallucinationSpeechMs && hallucinations.has(guard))) {
        this.stats.segmentsSkipped += 1;
        segment.state = "skipped";
      } else {
        this.stats.segmentsTranscribed += 1;
        segment.text = text;
        segment.state = "done";
      }
    } catch (error) {
      if (this.closed) return;
      segment.state = "failed";
      this.markFailed("segment_failed", error instanceof TranscriptionUnavailableError && (error.providerStatus === "timeout" || error.providerStatus === "aborted") ? "segment_timeout" : "segment_error");
      return;
    } finally {
      wav.fill(0);
    }
    this.drain();
  }

  /** Commits finished segments in order; a segment waits for every earlier one. Signals turn ends only for undisturbed pauses. */
  private drain(): void {
    if (this.closed || this.failed) return;
    while (this.committed < this.segments.length) {
      const segment = this.segments[this.committed]!;
      if (segment.state !== "done" && segment.state !== "skipped") return;
      this.committed += 1;
      if (segment.state === "done") {
        this.finals.push(segment.text);
        this.options.onCaptionChange?.();
      }
      if (segment.turnEnd && segment.epoch === this.speechEpoch && !this.flushing) {
        this.activeTurn = false;
        this.turnEnds += 1;
        this.turnObserver?.("end", segment.text);
        this.options.onCaptionChange?.();
        this.options.onTurnEnd?.(segment.text, { silenceStartedAt: segment.cutAt });
      }
    }
  }
}
