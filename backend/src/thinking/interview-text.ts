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

export function hasExactAnchorMention(text: string, anchor: string): boolean {
  return sequenceIndices(normalizedWords(text), normalizedWords(anchor)).length > 0;
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
