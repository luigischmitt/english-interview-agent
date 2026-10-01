import { azureHardBlockDurationMs, azureTargetBlockDurationMs, type AzureAudioBlock } from "./azure-aligned-blocks.js";

/**
 * Builds Azure pronunciation-assessment blocks from Cartesia Ink-2 turns (Ink-2 has no word timestamps).
 *
 * Everything here is in memory and content-light: turn transcripts become block reference text and are never logged.
 * Offsets are PCM byte positions (s16le mono 16 kHz) taken from the audio received when `turn.start` / `turn.end`
 * arrived, so they lag the real speech slightly: the speech of a turn ends before its end offset (endpointing delay)
 * and starts before its start offset (detection delay). Cuts therefore search for the quietest level frame near the
 * boundary instead of trusting the offsets.
 */

const sampleRate = 16_000;
const bytesPerSample = 2;
const bytesPerMs = (sampleRate * bytesPerSample) / 1_000;
/** How far before a `turn.start` / `turn.end` arrival a cut may be placed (speech edges precede event arrival). */
export const inkBoundarySearchMs = 600;
/** Maximum audio kept after the last `turn.end` arrival, so a block never trails far into silence. */
export const inkTailPadMs = 150;
const minimumBlockMs = 300;

export type InkTurnRecord = {
  /** Audio bytes received when `turn.start` arrived; null when the turn ended without a recorded start. */
  startByte: number | null;
  /** Audio bytes received when `turn.end` arrived. */
  endByte: number;
  transcript: string;
};

/** Level of the audio frame that ended at `endByte` (frames are contiguous: each starts where the previous ended). */
export type InkLevelFrame = { endByte: number; level: number };

export type InkBlocksFallbackReason = "no_turns" | "turn_too_long" | "inconsistent_turns" | "no_usable_blocks";
export type InkBlocksResult = { ok: true; blocks: AzureAudioBlock[] } | { ok: false; reason: InkBlocksFallbackReason };

export type InkBlockOptions = { targetMs?: number; hardMs?: number };

const evenFloor = (value: number) => Math.floor(value / bytesPerSample) * bytesPerSample;
const msToBytes = (milliseconds: number) => Math.round(milliseconds * bytesPerMs);

/** Midpoint of the quietest frame whose center lies in [lo, hi]; ties go to the frame nearest the window center. */
function quietestFrameCut(levels: InkLevelFrame[], lo: number, hi: number): number | null {
  const windowCenter = (lo + hi) / 2;
  let best: { level: number; distance: number; cut: number } | null = null;
  let frameStart = 0;
  for (const frame of levels) {
    const start = frameStart;
    frameStart = frame.endByte;
    const center = (start + frame.endByte) / 2;
    if (frame.endByte <= start || center < lo || center > hi || !Number.isFinite(frame.level)) continue;
    const distance = Math.abs(center - windowCenter);
    if (!best || frame.level < best.level || (frame.level === best.level && distance < best.distance)) {
      best = { level: frame.level, distance, cut: center };
    }
  }
  return best ? evenFloor(best.cut) : null;
}

export function buildInkTurnBlocks(turns: InkTurnRecord[], levels: InkLevelFrame[], totalBytes: number, options: InkBlockOptions = {}): InkBlocksResult {
  const targetBytes = msToBytes(options.targetMs ?? azureTargetBlockDurationMs);
  const hardBytes = msToBytes(options.hardMs ?? azureHardBlockDurationMs);
  const usable = turns.filter((turn) => turn.transcript.trim());
  if (!usable.length || totalBytes <= 0) return { ok: false, reason: "no_turns" };

  let previousEnd = 0;
  for (const turn of usable) {
    if (turn.startByte === null || !Number.isFinite(turn.startByte) || !Number.isFinite(turn.endByte)
      || turn.startByte < previousEnd || turn.endByte <= turn.startByte || turn.endByte > totalBytes) return { ok: false, reason: "inconsistent_turns" };
    previousEnd = turn.endByte;
  }
  if (usable.some((turn) => turn.endByte - turn.startByte! > hardBytes)) return { ok: false, reason: "turn_too_long" };

  const search = msToBytes(inkBoundarySearchMs);
  // cuts[i] is the start of turn i's block candidate; cuts[n] closes the last turn.
  const cuts: number[] = [];
  const first = usable[0]!;
  const leadLo = Math.max(0, first.startByte! - search);
  cuts.push(quietestFrameCut(levels, leadLo, first.startByte!) ?? evenFloor(Math.max(leadLo, first.startByte! - msToBytes(inkTailPadMs))));
  for (let index = 0; index < usable.length - 1; index += 1) {
    const ended = usable[index]!.endByte;
    const next = usable[index + 1]!.startByte!;
    cuts.push(quietestFrameCut(levels, Math.max(cuts[index]!, ended - search), next) ?? evenFloor((ended + next) / 2));
  }
  const last = usable[usable.length - 1]!;
  const tailHi = Math.min(totalBytes, last.endByte + msToBytes(inkTailPadMs));
  cuts.push(quietestFrameCut(levels, Math.max(cuts[cuts.length - 1]!, last.endByte - search), tailHi) ?? evenFloor(Math.min(last.endByte, totalBytes)));
  for (let index = 1; index < cuts.length; index += 1) {
    if (cuts[index]! <= cuts[index - 1]!) return { ok: false, reason: "inconsistent_turns" };
  }

  const blocks: AzureAudioBlock[] = [];
  let groupStart = 0;
  const flush = (endExclusive: number): boolean => {
    const startByte = cuts[groupStart]!;
    const endByte = cuts[endExclusive]!;
    if (endByte - startByte > hardBytes) return false;
    const durationMs = (endByte - startByte) / bytesPerMs;
    if (durationMs >= minimumBlockMs) {
      blocks.push({ startByte, endByte, durationMs, referenceText: usable.slice(groupStart, endExclusive).map((turn) => turn.transcript.trim().replace(/\s+/g, " ")).join(" ") });
    }
    groupStart = endExclusive;
    return true;
  };
  for (let index = 1; index <= usable.length; index += 1) {
    const nextEnd = cuts[index]!;
    const isLast = index === usable.length;
    // Close the current group before turn `index - 1` when adding it would pass the target (never for a lone turn).
    if (index - 1 > groupStart && nextEnd - cuts[groupStart]! > targetBytes) {
      if (!flush(index - 1)) return { ok: false, reason: "turn_too_long" };
    }
    if (isLast && !flush(index)) return { ok: false, reason: "turn_too_long" };
  }
  return blocks.length ? { ok: true, blocks } : { ok: false, reason: "no_usable_blocks" };
}

/** Records Ink-2 turn arrivals and per-frame levels against the audio byte count; metadata + text only, no audio. */
export class InkTurnRecorder {
  private readonly turns: InkTurnRecord[] = [];
  private readonly levels: InkLevelFrame[] = [];
  private openStart: number | null = null;

  constructor(private readonly getBytes: () => number) {}

  turnEvent(kind: "start" | "end", transcript = ""): void {
    const bytes = this.getBytes();
    if (kind === "start") {
      this.openStart = bytes;
      return;
    }
    this.turns.push({ startByte: this.openStart, endByte: bytes, transcript });
    this.openStart = null;
  }

  /** Call after the frame the level describes was appended (the client sends each frame, then its level). */
  recordLevel(level: number): void {
    const endByte = this.getBytes();
    if (endByte > (this.levels[this.levels.length - 1]?.endByte ?? 0)) this.levels.push({ endByte, level });
  }

  get turnCount(): number { return this.turns.length; }

  build(totalBytes: number): InkBlocksResult & { turns: number } {
    return { ...buildInkTurnBlocks(this.turns, this.levels, totalBytes), turns: this.turns.length };
  }

  /** Concatenated turn texts, to confirm the blocks cover exactly the transcript the client received. */
  joinedText(): string {
    return this.turns.map((turn) => turn.transcript).join(" ").replace(/\s+/g, " ").trim();
  }

  clear(): void {
    this.turns.length = 0;
    this.levels.length = 0;
    this.openStart = null;
  }
}
