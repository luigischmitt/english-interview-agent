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

function normalizeToken(token: string): string {
  return token.replace(/[’]/g, "'").toLocaleLowerCase("en-US");
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
