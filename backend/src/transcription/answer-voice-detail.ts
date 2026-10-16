import { spawn } from "node:child_process";
import { materializeAzureBlock, normalizeToken, type AzureAudioBlock } from "./azure-aligned-blocks.js";
import type { AzureWordAssessment } from "./azure-pronunciation-assessment.js";
import type { TranscriptionWord } from "./types.js";

export type ProblemWord = { word: string; score: number | null; errorType: string | null; worstPhoneme: string | null; prosodyErrors: string[] };
export type AnswerPhrase = { phraseIndex: number; text: string; startMs: number; endMs: number; score: number; issue: "pronunciation" | "intonation"; problemWords: ProblemWord[] };
export type DeliveryMetrics = { wordsPerMinute: number; pauseCount: number; longestPauseMs: number; startDelayMs: number; fillerCount: number; fillers: Record<string, number> };

const tokenPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const fillerWords = new Set(["uh", "um", "uhm", "erm", "hmm", "like", "well"]);
const functionWords = new Set(("a an the I me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those who whom which what where when why how am is are was were be being been do does did doing have has had having will would shall should can could may might must to of in on at by for from with about as into over after before between through under across and but or nor so yet if then than because while although though unless until since whether both each every either neither another any some no not all much many few several such here there yes no yeah well okay okay's mm hmm").split(/\s+/u));
const contentWord = (token: string) => token.length >= 3 && !functionWords.has(token.toLocaleLowerCase("en-US")) && !/^[A-Z0-9]{2,}$/u.test(token);

/** Intonation (monotone runs, odd breaks) is noisy per word, so it only counts when the answer-level prosody is low. */
export function buildAnswerPhrases(transcript: string, azureWords: AzureWordAssessment[], options: { allowIntonation?: boolean } = {}): AnswerPhrase[] {
  const allowIntonation = options.allowIntonation === true;
  const candidates: AnswerPhrase[] = [];
  let azureCursor = 0;
  const sentenceParts = transcript.match(/[^.!?]+[.!?]*|[.!?]+/gu) ?? [];
  for (const part of sentenceParts) {
    const tokens = part.match(tokenPattern) ?? [];
    if (!tokens.length) continue;
    const matched: Array<{ token: string; word: AzureWordAssessment }> = [];
    for (const token of tokens) {
      const normalized = normalizeToken(token);
      let matchIndex = -1;
      for (let candidate = azureCursor; candidate < Math.min(azureWords.length, azureCursor + 4); candidate += 1) {
        if (normalizeToken(azureWords[candidate]!.word) === normalized) { matchIndex = candidate; break; }
      }
      if (matchIndex >= 0) { matched.push({ token, word: azureWords[matchIndex]! }); azureCursor = matchIndex + 1; }
    }
    const groups: Array<Array<{ token: string; word: AzureWordAssessment }>> = [];
    let group: typeof matched = [];
    for (let i = 0; i < matched.length; i += 1) {
      if (group.length && matched[i]!.word.startMs - matched[i - 1]!.word.endMs >= 350) { groups.push(group); group = []; }
      group.push(matched[i]!);
    }
    if (group.length) groups.push(group);
    for (const breathGroup of groups) {
      const repeated = (items: typeof matched) => {
        const words = items.map(({ token }) => normalizeToken(token));
        return words.some((word, i) => words.slice(Math.max(0, i - 3), i).includes(word));
      };
      const isProblem = (item: typeof matched[number], index: number) => {
        const { token, word } = item;
        const accuracy = word.accuracyScore;
        return contentWord(token) && !/^[A-Z0-9]{2,}$/u.test(token) && accuracy !== null && accuracy >= 30 && (accuracy <= 65 || word.errorType === "Mispronunciation") && !repeated(breathGroup.slice(Math.max(0, index - 3), index + 1));
      };
      const problems = breathGroup.flatMap((item, index) => isProblem(item, index) ? [index] : []);
      const monotone = breathGroup.map(({ word }) => word.prosodyErrors.includes("Monotone"));
      let monotoneRun = 0; let maxMonotoneRun = 0;
      for (const value of monotone) { monotoneRun = value ? monotoneRun + 1 : 0; maxMonotoneRun = Math.max(maxMonotoneRun, monotoneRun); }
      const intonationProblem = allowIntonation && (maxMonotoneRun >= 4 || breathGroup.some(({ word }) => word.prosodyErrors.some((e) => e === "UnexpectedBreak" || e === "MissingBreak")));
      const targets = [...problems.map((index) => ({ index, issue: "pronunciation" as const })), ...(intonationProblem ? [{ index: 0, issue: "intonation" as const }] : [])];
      for (const target of targets) {
        let start = 0; let end = breathGroup.length;
        if (breathGroup.length > 9) {
          start = Math.max(0, target.index - 3); end = Math.min(breathGroup.length, start + 8); start = Math.max(0, end - 8);
          while (start < target.index && !contentWord(breathGroup[start]!.token)) start += 1;
          while (end > target.index + 1 && !contentWord(breathGroup[end - 1]!.token)) end -= 1;
        }
        const phraseWords = breathGroup.slice(start, end);
        if (phraseWords.length < 3 || phraseWords.length > 9 || repeated(phraseWords) || phraseWords.some(({ word }) => word.accuracyScore !== null && word.accuracyScore < 30)) continue;
        if (phraseWords.some((item, i) => i > 0 && item.word.startMs - phraseWords[i - 1]!.word.endMs >= 350)) continue;
        const first = phraseWords[0]!.word; const last = phraseWords[phraseWords.length - 1]!.word;
        const avgDuration = (last.endMs - first.startMs) / phraseWords.length;
        if (avgDuration < 150 || avgDuration > 800) continue;
        const phraseProblems = problems.filter((index) => index >= start && index < end).map((index) => breathGroup[index]!);
        if (target.issue === "pronunciation" && !phraseProblems.length) continue;
        const scores = phraseWords.map(({ word }) => word).filter((word) => word.accuracyScore !== null);
        if (!scores.length) continue;
        const score = scores.reduce((sum, word) => sum + word.accuracyScore!, 0) / scores.length;
        const badWords = target.issue === "pronunciation" ? phraseProblems.map(({ word }) => ({ word: word.word, score: word.accuracyScore, errorType: word.errorType, worstPhoneme: [...word.phonemes].sort((a, b) => a.accuracyScore - b.accuracyScore)[0]?.phoneme ?? null, prosodyErrors: word.prosodyErrors.filter((error) => error !== "None") })) : [];
        const neighborBefore = azureWords.filter((word) => word.endMs <= first.startMs).sort((a, b) => b.endMs - a.endMs)[0] ?? null;
        const neighborAfter = azureWords.filter((word) => word.startMs >= last.endMs).sort((a, b) => a.startMs - b.startMs)[0] ?? null;
        const clipStart = Math.max(0, first.startMs - 200, neighborBefore ? (neighborBefore.endMs + first.startMs) / 2 : 0);
        const clipEnd = Math.min(last.endMs + 300, neighborAfter ? (last.endMs + neighborAfter.startMs) / 2 : Infinity, clipStart + 4500);
        candidates.push({ phraseIndex: -1, text: phraseWords.map(({ token }) => token).join(" "), startMs: Math.round(clipStart), endMs: Math.round(clipEnd), score,
          issue: target.issue, problemWords: badWords });
      }
    }
  }
  // One breath group with two problem words yields the same phrase twice; keep one.
  const unique = candidates.filter((phrase, index) => candidates.findIndex((other) => other.startMs === phrase.startMs && other.text === phrase.text) === index);
  const worstWord = (phrase: AnswerPhrase) => Math.min(...phrase.problemWords.map((word) => word.score ?? 100), phrase.score);
  const sorted = unique.sort((a, b) => (a.issue === b.issue ? worstWord(a) - worstWord(b) : a.issue === "pronunciation" ? -1 : 1) || a.startMs - b.startMs);
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
    // Phrase bounds already include natural margins (half the gap to neighbors), so the clip uses them as-is.
    const startMs = Math.max(0, phrase.startMs);
    const endMs = Math.min(durationMs, phrase.endMs, startMs + 5_000);
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
