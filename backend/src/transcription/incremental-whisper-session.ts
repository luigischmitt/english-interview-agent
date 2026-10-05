import { TranscriptionUnavailableError } from "./errors.js";
import type { StreamFailureReason, StreamingTurnSession, TurnEndInfo } from "./streaming-turn-session.js";
import { pcmToWav } from "./streaming-transcription.js";
import type { TranscriptionService } from "./types.js";

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
  /** Per-segment Whisper time limit, retries included. Default 8000. */
  segmentTimeoutMs?: number;
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
  onFailure?: (reason: StreamFailureReason) => void;
};

/** Phrases Whisper tends to invent on near-silence; dropped only when the segment had little speech. */
const hallucinations = new Set(["you", "thank you", "thanks", "thanks for watching", "thank you for watching", "bye", "bye bye", "the end"]);
const hallucinationSpeechMs = 1_200;

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
  private stats = { segmentsTranscribed: 0, segmentsSkipped: 0, tailMs: 0, maxSegmentLatencyMs: 0 };

  constructor(private readonly options: IncrementalWhisperOptions) {}

  setTurnObserver(observer: ((kind: "start" | "end", transcript: string) => void) | null): void {
    this.turnObserver = observer;
  }

  get failed(): boolean { return this.failedReason !== null; }
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
    if (this.activeTurn) return;
    this.activeTurn = true;
    this.turnObserver?.("start", "");
    this.options.onTurnStart?.();
  }

  recordLevel(level: number): void {
    if (!this.alive || this.flushing || !Number.isFinite(level)) return;
    this.levels.push(level);
  }

  sendAudio(frame: Buffer): void {
    if (!this.alive || this.flushing) return;
    this.chunks.push(Buffer.from(frame));
    this.bytes += frame.length;
    if (this.bytes >= (this.options.maxSegmentMs ?? 15_000) * bytesPerMs) this.forcedCut();
  }

  /** Pause detected by the local VAD: cut the pending segment, transcribe it and signal the turn end when it is ready. */
  async endTurn(_timeoutMs: number): Promise<void> {
    if (!this.alive || this.flushing || this.bytes === 0) return;
    const segment = this.cut(this.bytes, this.levels.length, true);
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
      const segment = this.cut(this.bytes, this.levels.length, false);
      if (segment && segment.state === "pending") this.stats.tailMs = Math.round(tailBytes / bytesPerMs);
    }
    const pending = this.segments.filter((segment) => segment.promise && segment.state === "pending").map((segment) => segment.promise!);
    if (pending.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
      const outcome = await Promise.race([Promise.all(pending).then(() => "done" as const), timedOut, this.waitClosed()]);
      clearTimeout(timer);
      if (outcome !== "done") this.markFailed("segment_failed");
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

  private markFailed(reason: StreamFailureReason): void {
    if (this.failedReason) return;
    this.failedReason = reason;
    this.options.onFailure?.(reason);
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
  private cut(byteCount: number, levelCount: number, turnEnd: boolean): Segment | null {
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
    segment.promise = this.transcribeSegment(segment, pcm, speechMs);
    return segment;
  }

  private async transcribeSegment(segment: Segment, pcm: Buffer, speechMs: number): Promise<void> {
    const wav = pcmToWav(pcm);
    pcm.fill(0);
    const startedAt = this.now;
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.options.segmentTimeoutMs ?? 8_000)]);
      let text = "";
      try {
        text = (await this.options.service.transcribe(wav, "whisper-large-v3-turbo", "wav", signal, { question: this.options.question ?? null, previousText: this.joined() })).transcript.trim();
      } catch (error) {
        // An empty recognition is a result (nothing said), not a failure.
        if (!(error instanceof TranscriptionUnavailableError && error.providerStatus === "empty")) throw error;
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
    } catch {
      if (this.closed) return;
      segment.state = "failed";
      this.markFailed("segment_failed");
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
