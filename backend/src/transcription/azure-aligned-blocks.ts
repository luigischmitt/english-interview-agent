import type { TranscriptionWord } from "./types.js";

export const azureTargetBlockDurationMs = 25_000;
export const azureHardBlockDurationMs = 30_000;
const sampleRate = 16_000;
const bytesPerSample = 2;

export type AzureAudioBlock = { startByte: number; endByte: number; referenceText: string; durationMs: number };

/**
 * Reuses only timestamped phrases that can be matched in order to the canonical Whisper
 * transcript. Untimed/mismatched gaps split snippets, and reference text always comes
 * from the canonical transcript rather than the timing retry.
 */
export function alignSegmentTimingToTranscript(segments: TranscriptionWord[], transcript: string): TranscriptionWord[] | undefined {
  const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  const transcriptTokens = [...transcript.matchAll(tokenPattern)];
  if (!transcriptTokens.length) return undefined;

  let tokenIndex = 0;
  let pendingBreak = false;
  const aligned: TranscriptionWord[] = [];
  for (const segment of segments) {
    const segmentTokens = [...segment.text.matchAll(tokenPattern)];
    if (!segmentTokens.length) {
      pendingBreak = true;
      continue;
    }
    let matchStart = -1;
    for (let candidate = tokenIndex; candidate + segmentTokens.length <= transcriptTokens.length; candidate += 1) {
      const matches = segmentTokens.every((token, offset) => normalizeToken(token[0]!) === normalizeToken(transcriptTokens[candidate + offset]![0]!));
      if (matches) {
        matchStart = candidate;
        break;
      }
    }
    if (matchStart < 0) {
      pendingBreak = true;
      continue;
    }
    const first = transcriptTokens[matchStart]!;
    const last = transcriptTokens[matchStart + segmentTokens.length - 1]!;
    aligned.push({
      ...segment,
      text: transcript.slice(first.index, last.index + last[0].length),
      breakBefore: pendingBreak || matchStart > tokenIndex,
    });
    pendingBreak = false;
    tokenIndex = matchStart + segmentTokens.length;
  }
  return aligned.length ? aligned : undefined;
}

export function normalizeToken(token: string): string {
  return token.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "");
}

/** Replaces timing block references with reviewed words mapped through an LCS token alignment. */
export function mapAzureBlockReferencesToReviewed(blocks: AzureAudioBlock[], draft: string, reviewed: string): AzureAudioBlock[] {
  const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  const draftTokens = [...draft.matchAll(tokenPattern)].map((match) => match[0]);
  const reviewedTokens = [...reviewed.matchAll(tokenPattern)].map((match) => match[0]);
  if (!draftTokens.length || !reviewedTokens.length) return blocks;
  const rows = draftTokens.length + 1;
  const cols = reviewedTokens.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = draftTokens.length - 1; i >= 0; i -= 1) for (let j = reviewedTokens.length - 1; j >= 0; j -= 1) {
    dp[i]![j] = normalizeToken(draftTokens[i]!) === normalizeToken(reviewedTokens[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const mapping = new Map<number, number>();
  let i = 0; let j = 0;
  while (i < draftTokens.length && j < reviewedTokens.length) {
    if (normalizeToken(draftTokens[i]!) === normalizeToken(reviewedTokens[j]!)) { mapping.set(i++, j++); }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i += 1;
    else j += 1;
  }
  let cursor = 0;
  return blocks.map((block) => {
    const count = (block.referenceText.match(tokenPattern) ?? []).length;
    if (!count) return block;
    const target = (block.referenceText.match(tokenPattern) ?? []).map((token) => normalizeToken(token));
    while (cursor < draftTokens.length && normalizeToken(draftTokens[cursor]!) !== target[0]) cursor += 1;
    const firstDraft = cursor;
    let matched = 0;
    while (cursor < draftTokens.length && matched < target.length) {
      if (normalizeToken(draftTokens[cursor]!) === target[matched]) matched += 1;
      cursor += 1;
    }
    const lastDraft = Math.max(firstDraft, cursor - 1);
    const previousAnchor = [...mapping.entries()].filter(([draftIndex]) => draftIndex < firstDraft).at(-1);
    const nextAnchor = [...mapping.entries()].find(([draftIndex]) => draftIndex > lastDraft);
    const start = mapping.get(firstDraft) ?? (previousAnchor ? previousAnchor[1] + 1 : 0);
    const end = mapping.get(lastDraft) ?? (nextAnchor ? nextAnchor[1] - 1 : reviewedTokens.length - 1);
    if (start < 0 || end < start) return block;
    return { ...block, referenceText: reviewedTokens.slice(start, end + 1).join(" ") };
  });
}

/** Groups adjacent, timestamped words deterministically and slices the canonical mono 16 kHz WAV. */
export function createAzureAlignedBlocks(wav: Buffer, words: TranscriptionWord[]): AzureAudioBlock[] {
  const pcmLength = wav.length - 44;
  if (pcmLength <= 0 || pcmLength % bytesPerSample !== 0 || wav.toString("ascii", 0, 4) !== "RIFF") return [];
  const durationSeconds = pcmLength / (sampleRate * bytesPerSample);
  const groups: TranscriptionWord[][] = [];
  let group: TranscriptionWord[] = [];
  let previousEnd = 0;
  for (const word of words) {
    if (!word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end)
      || word.start < 0 || word.end <= word.start || word.end > durationSeconds || word.start < previousEnd) return [];
    if (word.breakBefore && group.length) {
      groups.push(group);
      group = [];
    }
    const currentFirst = group[0];
    const wordStartSample = Math.round(word.start * sampleRate);
    const wordEndSample = Math.round(word.end * sampleRate);
    if (currentFirst && (wordEndSample - Math.round(currentFirst.start * sampleRate)) / sampleRate * 1_000 > azureTargetBlockDurationMs) {
      groups.push(group);
      group = [];
    }
    if ((wordEndSample - wordStartSample) / sampleRate * 1_000 > azureTargetBlockDurationMs) return [];
    group.push(word);
    previousEnd = word.end;
  }
  if (group.length) groups.push(group);

  return groups.flatMap((wordsInGroup) => {
    const first = wordsInGroup[0]!;
    const last = wordsInGroup[wordsInGroup.length - 1]!;
    const startSample = Math.round(first.start * sampleRate);
    const endSample = Math.round(last.end * sampleRate);
    const durationMs = (endSample - startSample) / sampleRate * 1_000;
    if (durationMs > azureTargetBlockDurationMs || durationMs > azureHardBlockDurationMs) return [];
    return [{ startByte: startSample * bytesPerSample, endByte: endSample * bytesPerSample, referenceText: wordsInGroup.map((word) => word.text.trim()).join(" "), durationMs }];
  });
}

export function materializeAzureBlock(wav: Buffer, block: AzureAudioBlock): Buffer {
  const pcm = wav.subarray(44 + block.startByte, 44 + block.endByte);
  const slice = Buffer.allocUnsafe(44 + pcm.length);
  slice.write("RIFF", 0); slice.writeUInt32LE(36 + pcm.length, 4); slice.write("WAVE", 8);
  slice.write("fmt ", 12); slice.writeUInt32LE(16, 16); slice.writeUInt16LE(1, 20);
  slice.writeUInt16LE(1, 22); slice.writeUInt32LE(sampleRate, 24); slice.writeUInt32LE(sampleRate * bytesPerSample, 28);
  slice.writeUInt16LE(bytesPerSample, 32); slice.writeUInt16LE(16, 34); slice.write("data", 36);
  slice.writeUInt32LE(pcm.length, 40); pcm.copy(slice, 44);
  return slice;
}

export type AzureBlockScoreInput = { durationMs: number; scores: { accuracy: number | null; fluency: number | null; prosody: number | null } | null };
export type AzureAnswerScores = { accuracy: number | null; fluency: number | null; prosody: number | null };

/**
 * Per-answer score: mean of each dimension over the assessed blocks, weighted by block duration.
 * Failed blocks (null scores) and null dimensions are skipped per dimension, never counted as zero.
 */
export function aggregateAzureBlockScores(blocks: AzureBlockScoreInput[]): AzureAnswerScores {
  const result: AzureAnswerScores = { accuracy: null, fluency: null, prosody: null };
  for (const dimension of Object.keys(result) as (keyof AzureAnswerScores)[]) {
    const available = blocks.flatMap(({ scores, durationMs }) => {
      const score = scores?.[dimension];
      return score === null || score === undefined || !Number.isFinite(durationMs) || durationMs <= 0 ? [] : [{ score, durationMs }];
    });
    const totalDurationMs = available.reduce((sum, item) => sum + item.durationMs, 0);
    if (totalDurationMs > 0) result[dimension] = available.reduce((sum, item) => sum + item.score * item.durationMs, 0) / totalDurationMs;
  }
  return result;
}
