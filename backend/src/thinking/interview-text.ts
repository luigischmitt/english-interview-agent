// Text helpers shared by the next-turn decision and the bridge step (moved verbatim from the orchestration service).

export const tokenPattern = /[\p{L}\p{N}]+(?:[+#]+)?/gu;

/** Case-, punctuation- and whitespace-insensitive word tokens; "C++" and "C#" stay distinct, hyphens and quotes split words. */
export function normalizedWords(text: string): string[] {
  return (text.toLocaleLowerCase().match(tokenPattern) ?? []);
}

export function sequenceIndices(haystack: string[], needle: string[]): number[] {
  if (needle.length === 0) return [];
  const indices: number[] = [];
  for (let index = 0; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) indices.push(index);
  }
  return indices;
}

/** Hesitation sounds that Whisper transcribes verbatim; ignored when matching an anchor against speech. */
const fillerWords = new Set(["ah", "eh", "er", "erm", "hmm", "mm", "uh", "uhm", "um"]);

/** Anchor-side cleanup: drops hesitation sounds and collapses immediate repeats ("the the" -> "the"). */
function cleanAnchorWords(words: string[]): string[] {
  const cleaned: string[] = [];
  for (const word of words) {
    if (fillerWords.has(word) || cleaned[cleaned.length - 1] === word) continue;
    cleaned.push(word);
  }
  return cleaned;
}

/** Number of transcript tokens at `index` that carry no content: a filler, a mid-anchor "like", "you know", "I mean" or a stutter repeat. */
function skippableRun(words: string[], index: number, previousWord: string | undefined, midAnchor: boolean): number {
  const word = words[index];
  if (fillerWords.has(word) || word === previousWord) return 1;
  if (midAnchor && word === "like") return 1;
  if (midAnchor && ((word === "you" && words[index + 1] === "know") || (word === "i" && words[index + 1] === "mean"))) return 2;
  return 0;
}

/**
 * Every [start, end) token range of `words` that spells the anchor, tolerating speech disfluency: filler sounds, "you know",
 * "I mean" and "like" between anchor words, and immediate repeated words. A token is skipped only when it would otherwise
 * break the match, so literal mentions of those words still match literally. No fuzzy substitutions.
 */
export function tolerantSequenceRanges(words: string[], anchorWords: string[]): Array<[number, number]> {
  const needle = cleanAnchorWords(anchorWords);
  const ranges: Array<[number, number]> = [];
  if (needle.length === 0) return ranges;
  for (let start = 0; start < words.length; start += 1) {
    if (words[start] !== needle[0]) continue;
    let matched = 1; let cursor = start + 1;
    while (matched < needle.length && cursor < words.length) {
      if (words[cursor] === needle[matched]) { matched += 1; cursor += 1; continue; }
      const skip = skippableRun(words, cursor, words[cursor - 1], true);
      if (skip === 0) break;
      cursor += skip;
    }
    if (matched === needle.length) ranges.push([start, cursor]);
  }
  return ranges;
}

/** Exact substring of `text` (original case and fillers included) that the anchor spells, tolerating disfluency; null if absent. */
export function tolerantAnchorSpan(text: string, anchor: string): string | null {
  const tokens = [...text.matchAll(tokenPattern)];
  const range = tolerantSequenceRanges(tokens.map(([token]) => token.toLocaleLowerCase()), normalizedWords(anchor))[0];
  if (!range) return null;
  const first = tokens[range[0]]; const last = tokens[range[1] - 1];
  if (first?.index === undefined || last?.index === undefined) return null;
  return text.slice(first.index, last.index + last[0].length);
}

export function hasExactAnchorMention(text: string, anchor: string): boolean {
  return tolerantSequenceRanges(normalizedWords(text), normalizedWords(anchor)).length > 0;
}

export const lowInformationWords = new Set(["a", "about", "ah", "am", "an", "and", "are", "as", "at", "but", "by", "for", "from", "hmm", "i", "is", "it", "like", "maybe", "me", "mm", "my", "of", "oh", "okay", "ok", "on", "or", "so", "the", "this", "uh", "um", "uhm", "well", "yeah", "yes", "you"]);
export const questionStopWords = new Set(["a", "about", "an", "and", "are", "as", "at", "can", "could", "describe", "did", "do", "for", "from", "give", "had", "have", "how", "i", "in", "is", "it", "me", "of", "on", "or", "please", "tell", "that", "the", "there", "to", "was", "way", "what", "when", "where", "which", "who", "why", "with", "would", "you", "your"]);
export const followUpStopWords = new Set([...questionStopWords, "also", "any", "choose", "choosing", "chosen", "consider", "considered", "cons", "didn", "does", "during", "else", "ever", "exactly", "factor", "factors", "happen", "happened", "impact", "make", "made", "much", "off", "offs", "one", "particular", "pro", "pros", "project", "reason", "reasons", "select", "selected", "selecting", "specific", "system", "thing", "things", "through", "trade", "tradeoff", "tradeoffs", "use", "used", "using", "way", "work", "worked"]);

export function contentWords(text: string): Set<string> {
  const words = text.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length > 2 && !followUpStopWords.has(word)).map((word) => {
    let stem = word;
    if (stem.endsWith("ies") && stem.length > 4) stem = `${stem.slice(0, -3)}y`;
    else if (stem.endsWith("ing") && stem.length > 5) stem = stem.slice(0, -3);
    else if (stem.endsWith("ed") && stem.length > 4) stem = stem.slice(0, -2);
    else if (stem.endsWith("es") && stem.length > 4) stem = stem.slice(0, -2);
    else if (stem.endsWith("s") && !stem.endsWith("ss") && stem.length > 3) stem = stem.slice(0, -1);
    return stem.length > 4 && stem.endsWith("e") ? stem.slice(0, -1) : stem;
  }));
}

export function containsNoiseToken(text: string): boolean {
  return (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some((word) => /^(?:p+f{2,}|tf{3,})$/u.test(word));
}

export function transcriptHasUsefulContent(transcript: string): boolean {
  const words = transcript.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length > 1 && !lowInformationWords.has(word))).size >= 2;
}

/**
 * Clips an over-long literal span to the contiguous window (at most `maxWords` whitespace words and `maxChars` characters) that shares
 * the most content words with the question; ties go to the earliest window. The result is a character-exact slice of `span`.
 * Returns null when the span already fits (nothing to clip).
 */
export function clipAnchorSpan(span: string, question: string, maxWords = 12, maxChars = 140): string | null {
  const words = [...span.matchAll(/\S+/gu)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
  if (words.length <= maxWords && span.length <= maxChars) return null;
  const wanted = contentWords(question);
  let best: { score: number; slice: string } | null = null;
  for (let first = 0; first < words.length; first += 1) {
    let last = Math.min(words.length, first + maxWords) - 1;
    while (last > first && words[last].end - words[first].start > maxChars) last -= 1;
    const slice = span.slice(words[first].start, words[last].end);
    if (slice.length > maxChars) continue;
    const found = contentWords(slice);
    const score = [...wanted].filter((word) => found.has(word)).length;
    if (best === null || score > best.score) best = { score, slice };
  }
  return best?.slice ?? null;
}
