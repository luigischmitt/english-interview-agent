import { spawn } from "node:child_process";
import { materializeAzureBlock, normalizeToken, type AzureAudioBlock } from "./azure-aligned-blocks.js";
import type { AzureWordAssessment } from "./azure-pronunciation-assessment.js";
import type { TranscriptionWord } from "./types.js";

export type ProblemWord = { word: string; score: number | null; errorType: string | null; worstPhoneme: string | null; prosodyErrors: string[] };
export type AnswerPhrase = { phraseIndex: number; text: string; startMs: number; endMs: number; score: number; issue: "pronunciation" | "intonation"; problemWords: ProblemWord[] };
export type DeliveryMetrics = { wordsPerMinute: number; pauseCount: number; longestPauseMs: number; startDelayMs: number; fillerCount: number; fillers: Record<string, number> };

const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const fillerWords = new Set(["uh", "um", "uhm", "erm", "hmm", "like", "well"]);

function transcriptSentences(transcript: string): string[][] {
  return (transcript.trim().match(/[^.!?]+(?:[.!?]+|$)/gu) ?? []).map((part) => part.match(tokenPattern) ?? []).filter((tokens) => tokens.length > 0);
}

/** Intonation (monotone runs, odd breaks) is noisy per word, so it only counts when the answer-level prosody is low. */
export function buildAnswerPhrases(transcript: string, azureWords: AzureWordAssessment[], options: { allowIntonation?: boolean } = {}): AnswerPhrase[] {
  const allowIntonation = options.allowIntonation === true;
  const candidates: AnswerPhrase[] = [];
  let azureCursor = 0;
  for (const tokens of transcriptSentences(transcript)) {
    const matched: Array<{ token: string; word: AzureWordAssessment }> = [];
    for (const token of tokens) {
      const normalized = normalizeToken(token);
      let matchIndex = -1;
      for (let candidate = azureCursor; candidate < Math.min(azureWords.length, azureCursor + 4); candidate += 1) {
        if (normalizeToken(azureWords[candidate]!.word) === normalized) { matchIndex = candidate; break; }
      }
      if (matchIndex >= 0) { matched.push({ token, word: azureWords[matchIndex]! }); azureCursor = matchIndex + 1; }
    }
    const monotone = matched.map(({ word }) => word.prosodyErrors.includes("Monotone"));
    const intonation = new Set<number>();
    for (let i = 0; i < monotone.length;) {
      if (!monotone[i]) { i += 1; continue; }
      let end = i + 1;
      while (end < monotone.length && monotone[end]) end += 1;
      if (allowIntonation && end - i >= 4) for (let j = i; j < end; j += 1) intonation.add(j);
      i = end;
    }
    const isPronunciationProblem = (word: AzureWordAssessment) => (word.accuracyScore !== null && word.accuracyScore < 70) || word.errorType === "Mispronunciation";
    const isIntonationProblem = (word: AzureWordAssessment, index: number) => intonation.has(index) || (allowIntonation && word.prosodyErrors.some((error) => error === "UnexpectedBreak" || error === "MissingBreak"));
    const problems = matched.flatMap(({ word }, index) => isPronunciationProblem(word) || isIntonationProblem(word, index) ? [index] : []);
    const windows: Array<[number, number]> = [];
    for (const problem of problems) {
      let start = Math.max(0, problem - 2);
      let end = Math.min(matched.length, start + 5);
      start = Math.max(0, end - 8);
      if (end - start < 3) { start = Math.max(0, end - 3); end = Math.min(matched.length, start + 3); }
      if (end - start < 3) continue;
      const previous = windows[windows.length - 1];
      if (previous && start < previous[1] && Math.max(previous[1], end) - previous[0] <= 8) previous[1] = Math.max(previous[1], end);
      else {
        if (previous && start < previous[1]) {
          start = previous[1];
          end = Math.min(matched.length, Math.max(end, start + 3));
        }
        if (end - start >= 3) windows.push([start, Math.min(end, start + 8)]);
      }
    }
    for (const [start, end] of windows) {
      const phraseWords = matched.slice(start, end);
      if (phraseWords.length < 3 || phraseWords.length > 8) continue;
      const normalized = phraseWords.map(({ token }) => normalizeToken(token));
      if (normalized.filter((word) => word.length === 1).length * 2 > normalized.length || normalized.some((word, index) => index > 0 && word === normalized[index - 1]) || normalized.every((word) => fillerWords.has(word))) continue;
      const scored = phraseWords.map(({ word }) => word).filter((word) => word.accuracyScore !== null);
      if (!scored.length) continue;
      const duration = scored.reduce((sum, word) => sum + word.endMs - word.startMs, 0);
      if (duration <= 0) continue;
      const score = scored.reduce((sum, word) => sum + word.accuracyScore! * (word.endMs - word.startMs), 0) / duration;
      // Only mispronounced words are underlined; an intonation phrase is judged as a whole.
      const badWords = phraseWords.flatMap(({ word }) => {
        return isPronunciationProblem(word) ? [{ word: word.word, score: word.accuracyScore, errorType: word.errorType, worstPhoneme: [...word.phonemes].sort((a, b) => a.accuracyScore - b.accuracyScore)[0]?.phoneme ?? null, prosodyErrors: word.prosodyErrors.filter((error) => error !== "None") }] : [];
      });
      const startMs = Math.round(Math.min(...phraseWords.map(({ word }) => word.startMs)));
      const endMs = Math.round(Math.max(...phraseWords.map(({ word }) => word.endMs)));
      candidates.push({ phraseIndex: -1, text: phraseWords.map(({ token }) => token).join(" "), startMs, endMs, score,
        issue: phraseWords.some(({ word }) => isPronunciationProblem(word)) ? "pronunciation" : "intonation", problemWords: badWords });
    }
  }
  const sorted = candidates.sort((a, b) => (a.issue === b.issue ? a.score - b.score : a.issue === "pronunciation" ? -1 : 1) || a.startMs - b.startMs);
  const ranked = [...sorted.filter((phrase) => phrase.issue === "pronunciation"), ...sorted.filter((phrase) => phrase.issue === "intonation").slice(0, 1)].slice(0, 3);
  return ranked.map((phrase, phraseIndex) => ({ ...phrase, phraseIndex }));
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

/** Encodes at most three short phrase clips with bounded margins. Audio and intermediates remain in memory and are zeroed. */
export async function createPhraseClips(wav: Buffer, phrases: AnswerPhrase[], options: { spawnProcess?: typeof spawn; timeoutMs?: number; maxOutputBytes?: number } = {}): Promise<Array<{ phraseIndex: number; startMs: number; endMs: number; mimeType: "audio/webm;codecs=opus"; base64: string }>> {
  const results = await Promise.all(phrases.slice(0, 3).map(async (phrase) => {
    const durationMs = wav.length >= 44 ? (wav.length - 44) / 32 : 0;
    const startMs = Math.max(0, phrase.startMs - 250);
    const endMs = Math.min(durationMs, phrase.endMs + 250, startMs + 4_000);
    if (endMs <= startMs) return null;
    const block: AzureAudioBlock = { startByte: Math.floor(startMs * 32), endByte: Math.floor(endMs * 32), referenceText: "", durationMs: endMs - startMs };
    let slice: Buffer | null = null;
    try {
      slice = materializeAzureBlock(wav, block);
      const encoded = await encodeWebmOpus(slice, options);
      try { return { phraseIndex: phrase.phraseIndex, startMs, endMs, mimeType: "audio/webm;codecs=opus" as const, base64: encoded.toString("base64") }; }
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
