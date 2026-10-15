import { spawn } from "node:child_process";
import { materializeAzureBlock, normalizeToken, type AzureAudioBlock } from "./azure-aligned-blocks.js";
import type { AzureWordAssessment } from "./azure-pronunciation-assessment.js";
import type { TranscriptionWord } from "./types.js";

export type ProblemWord = { word: string; score: number | null; errorType: string | null; worstPhoneme: string | null };
export type AnswerSentence = { sentenceIndex: number; text: string; startMs: number; endMs: number; score: number; problemWords: ProblemWord[] };
export type DeliveryMetrics = { wordsPerMinute: number; pauseCount: number; longestPauseMs: number; startDelayMs: number; fillerCount: number; fillers: Record<string, number> };

const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function splitAnswerSentences(transcript: string): string[] {
  const text = transcript.trim();
  if (!text) return [];
  const punctuated = text.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (punctuated.some((part) => /[.!?]/u.test(part))) return punctuated;
  const words = text.split(/\s+/u);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 20) chunks.push(words.slice(i, i + 20).join(" "));
  return chunks;
}

export function buildAnswerSentences(transcript: string, azureWords: AzureWordAssessment[]): AnswerSentence[] {
  const sentences: AnswerSentence[] = [];
  let azureCursor = 0;
  let sentenceIndex = 0;
  for (const text of splitAnswerSentences(transcript)) {
    const currentSentenceIndex = sentenceIndex++;
    const tokens = text.match(tokenPattern) ?? [];
    if (tokens.length < 4) continue;
    const matched: AzureWordAssessment[] = [];
    for (const token of tokens) {
      const normalized = normalizeToken(token);
      let matchIndex = -1;
      for (let candidate = azureCursor; candidate < Math.min(azureWords.length, azureCursor + 4); candidate += 1) {
        if (normalizeToken(azureWords[candidate]!.word) === normalized) { matchIndex = candidate; break; }
      }
      if (matchIndex >= 0) {
        matched.push(azureWords[matchIndex]!);
        azureCursor = matchIndex + 1;
      }
    }
    const scored = matched.filter((word) => word.accuracyScore !== null);
    if (scored.length / tokens.length < 0.8) continue;
    const startMs = Math.round(Math.min(...matched.map((word) => word.startMs)));
    const endMs = Math.round(Math.max(...matched.map((word) => word.endMs)));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const duration = scored.reduce((sum, word) => sum + word.endMs - word.startMs, 0);
    if (duration <= 0) continue;
    const score = scored.reduce((sum, word) => sum + word.accuracyScore! * (word.endMs - word.startMs), 0) / duration;
    sentences.push({
      sentenceIndex: currentSentenceIndex, text, startMs, endMs, score,
      problemWords: matched.flatMap((word) => ((word.accuracyScore !== null && word.accuracyScore < 60) || (word.errorType !== null && word.errorType !== "None")) ? [{ word: word.word, score: word.accuracyScore, errorType: word.errorType, worstPhoneme: [...word.phonemes].sort((a, b) => a.accuracyScore - b.accuracyScore)[0]?.phoneme ?? null }] : []),
    });
  }
  return sentences.sort((a, b) => a.score - b.score);
}

export function calculateDeliveryMetrics(words: TranscriptionWord[]): DeliveryMetrics | undefined {
  const timed = words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start).sort((a, b) => a.start - b.start);
  if (!timed.length) return undefined;
  const activeSeconds = timed[timed.length - 1]!.end - timed[0]!.start;
  const count = timed.reduce((sum, word) => sum + (word.text.match(tokenPattern)?.length ?? 0), 0);
  const pauses = timed.slice(1).map((word, index) => Math.max(0, (word.start - timed[index]!.end) * 1_000)).filter((gap) => gap >= 1_500);
  const fillers: Record<string, number> = { uh: 0, um: 0, uhm: 0, erm: 0, "you know": 0, "I mean": 0 };
  const text = timed.map((word) => word.text.toLocaleLowerCase("en-US")).join(" ").replace(/[^\p{L}\p{N}'’\s]/gu, " ").replace(/\s+/gu, " ");
  for (const item of ["uh", "um", "uhm", "erm"] as const) fillers[item] = (text.match(new RegExp(`\\b${item}\\b`, "gu")) ?? []).length;
  fillers["you know"] = (text.match(/\byou know\b/gu) ?? []).length;
  fillers["I mean"] = (text.match(/\bi mean\b/giu) ?? []).length;
  return { wordsPerMinute: activeSeconds > 0 ? count * 60 / activeSeconds : 0, pauseCount: pauses.length, longestPauseMs: Math.round(Math.max(0, ...pauses)), startDelayMs: Math.round(timed[0]!.start * 1_000), fillerCount: Object.values(fillers).reduce((sum, value) => sum + value, 0), fillers };
}

/** Encodes at most two low-scoring answer excerpts. Audio and intermediates remain in memory and are zeroed. */
export async function createSentenceClips(wav: Buffer, sentences: AnswerSentence[], options: { spawnProcess?: typeof spawn; timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<Array<{ sentenceIndex: number; startMs: number; endMs: number; mimeType: "audio/webm;codecs=opus"; base64: string }>> {
  const candidates = sentences.filter((sentence) => sentence.score < 75).slice(0, 2);
  const results = await Promise.all(candidates.map(async (sentence) => {
    const durationMs = wav.length >= 44 ? (wav.length - 44) / 32 : 0;
    const startMs = Math.max(0, sentence.startMs - 300);
    const endMs = Math.min(durationMs, sentence.endMs + 300, startMs + 10_000);
    if (endMs <= startMs) return null;
    const block: AzureAudioBlock = { startByte: Math.floor(startMs * 32), endByte: Math.floor(endMs * 32), referenceText: "", durationMs: endMs - startMs };
    let slice: Buffer | null = null;
    try {
      slice = materializeAzureBlock(wav, block);
      const encoded = await encodeWebmOpus(slice, options);
      try { return { sentenceIndex: sentence.sentenceIndex, startMs, endMs, mimeType: "audio/webm;codecs=opus" as const, base64: encoded.toString("base64") }; }
      finally { encoded.fill(0); }
    } catch { return null; }
    finally { slice?.fill(0); }
  }));
  return results.filter((clip): clip is NonNullable<typeof clip> => clip !== null);
}

function encodeWebmOpus(wav: Buffer, options: { spawnProcess?: typeof spawn; timeoutMs?: number; maxOutputBytes?: number }): Promise<Buffer> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const maxOutputBytes = options.maxOutputBytes ?? 512 * 1024;
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawnProcess("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] }); }
    catch { reject(new Error("Clip encoder unavailable")); return; }
    if (!child.stdin || !child.stdout) { child.kill("SIGKILL"); reject(new Error("Clip encoder unavailable")); return; }
    const chunks: Buffer[] = []; let bytes = 0; let settled = false;
    const finish = (error?: Error, output?: Buffer) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { for (const chunk of chunks) chunk.fill(0); reject(error); } else resolve(output!); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("Clip encoder timed out")); }, options.timeoutMs ?? 5_000);
    child.stdout.on("data", (part: Buffer) => { bytes += part.length; if (bytes > maxOutputBytes) { part.fill(0); child.kill("SIGKILL"); finish(new Error("Clip output too large")); return; } chunks.push(part); });
    child.on("error", () => finish(new Error("Clip encoder unavailable")));
    child.on("close", (code) => {
      if (code === 0 && bytes > 0) {
        const output = Buffer.concat(chunks, bytes);
        for (const chunk of chunks) chunk.fill(0);
        finish(undefined, output);
      } else finish(new Error("Clip encoding failed"));
    });
    child.stdin.on("error", () => finish(new Error("Clip encoding failed")));
    child.stdin.end(wav);
  });
}
