/**
 * Server-side port of the client's interviewer speech chunking (frontend/src/lib/interview/speech-playback.mjs:
 * `splitInterviewerSpeech`, `groupInterviewerSentences`) and of the text composition that precedes it
 * (`composeAcknowledgedQuestion`, `stripLeadingAcknowledgement`, `isAcknowledgeableAnswer`).
 *
 * The server pre-synthesizes an utterance as soon as the next-turn decision is known, and a later POST /speech for a
 * chunk only hits the cache when the chunk text is byte-identical to what the client would send. A test compares this
 * port with the frontend module for representative utterances; change both together.
 */

export const firstChunkSplitThreshold = 50;
export const firstChunkSentenceMaximum = 70;
export const firstChunkPartMinimum = 25;
export const minimumChunkCharacters = 25;
export const mergeBelowCharacters = 40;
export const maximumChunkCharacters = 180;
const firstChunkGrowthMaximum = 100;
export const laterChunkPartMinimum = 25;

const clauseBoundaries = [", ", "; ", " — ", ": "];
const conjunctionBoundaries = [" because ", " so ", " and ", " but ", " which ", " when ", " while ", " where ", " that ", " to "];

type Unit = { text: string; caption: string };
type Split = { head: string; tail: string };

export function splitInterviewerSpeech(text: string): string[] {
  const content = text.trim();
  if (!content) return [];

  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(content)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  }

  return (content.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [content])
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function splitAtFirstClause(sentence: string, minimum: number): Split | null {
  let best: Split | null = null;
  for (const boundary of clauseBoundaries) {
    for (let at = sentence.indexOf(boundary); at !== -1; at = sentence.indexOf(boundary, at + 1)) {
      const head = (boundary === " — " ? sentence.slice(0, at) : sentence.slice(0, at + boundary.trimEnd().length)).trim();
      const tail = sentence.slice(at + boundary.length).trim();
      if (head.length < minimum || !tail) continue;
      if (!best || head.length < best.head.length) best = { head, tail };
      break;
    }
  }
  return best;
}

function splitLongSentence(sentence: string, cap: number): Split | null {
  const minimum = laterChunkPartMinimum;
  const candidates: Split[] = [];
  for (const boundary of clauseBoundaries) {
    for (let at = sentence.indexOf(boundary); at !== -1; at = sentence.indexOf(boundary, at + 1)) {
      const cut = boundary === " — " ? at : at + boundary.trimEnd().length;
      candidates.push({ head: sentence.slice(0, cut).trim(), tail: sentence.slice(at + boundary.length).trim() });
    }
  }
  const usable = (list: Split[]) => list.filter(({ head, tail }) => head.length >= minimum && head.length <= cap && tail.length >= minimum);
  const pickLatest = (list: Split[]) => list.reduce<Split | null>((best, entry) => (!best || entry.head.length > best.head.length ? entry : best), null);
  const clause = pickLatest(usable(candidates));
  if (clause) return clause;
  const lower = sentence.toLowerCase();
  const conjunctions: Split[] = [];
  for (const word of conjunctionBoundaries) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      conjunctions.push({ head: sentence.slice(0, at).trim(), tail: sentence.slice(at + 1).trim() });
    }
  }
  const conjunction = pickLatest(usable(conjunctions));
  if (conjunction) return conjunction;
  const at = sentence.lastIndexOf(" ", cap);
  if (at >= minimum && sentence.slice(at + 1).trim().length >= 1) return { head: sentence.slice(0, at).trim(), tail: sentence.slice(at + 1).trim() };
  return null;
}

function splitToFit(sentence: string, cap: number): string[] {
  if (sentence.length <= cap) return [sentence];
  const split = splitLongSentence(sentence, cap);
  return split ? [split.head, ...splitToFit(split.tail, cap)] : [sentence];
}

export type InterviewerChunk = { text: string; sentences: string[]; units: Unit[] };

export function groupInterviewerSentences(segments: string[]): InterviewerChunk[] {
  const sentences = segments.map((segment) => segment.trim()).filter(Boolean);
  if (!sentences.length) return [];
  const lengthOf = (units: Unit[]) => units.map((unit) => unit.text).join(" ").length;
  const unitOf = (text: string, caption: string): Unit => ({ text, caption });
  const chunks: Array<{ units: Unit[]; first: boolean }> = [];
  let remainder = sentences.map((sentence) => unitOf(sentence, sentence));

  if (sentences.join(" ").length > firstChunkSplitThreshold) {
    const [firstSentence, ...others] = sentences as [string, ...string[]];
    const caption = firstSentence;
    let first: Unit[];
    remainder = others.map((sentence) => unitOf(sentence, sentence));
    if (firstSentence.length <= firstChunkSentenceMaximum) {
      first = [unitOf(firstSentence, caption)];
      while (lengthOf(first) < minimumChunkCharacters && remainder.length && lengthOf([...first, remainder[0]!]) <= firstChunkGrowthMaximum) first.push(remainder.shift()!);
    } else {
      const split = splitAtFirstClause(firstSentence, firstChunkPartMinimum);
      if (split) {
        first = [unitOf(split.head, caption)];
        remainder = [...splitToFit(split.tail, maximumChunkCharacters).map((text) => unitOf(text, caption)), ...remainder];
      } else {
        first = [unitOf(firstSentence, caption)];
      }
    }
    chunks.push({ units: first, first: true });
  }
  const later = remainder.flatMap((unit) => splitToFit(unit.text, maximumChunkCharacters).map((text) => unitOf(text, unit.caption)));

  let pending: Unit[] = [];
  const flush = () => { if (pending.length) chunks.push({ units: pending, first: false }); pending = []; };
  for (const unit of later) {
    if (pending.length && (lengthOf(pending) >= mergeBelowCharacters || lengthOf([...pending, unit]) > maximumChunkCharacters)) flush();
    pending.push(unit);
  }
  if (pending.length) {
    const previous = chunks[chunks.length - 1];
    const joined = previous ? lengthOf([...previous.units, ...pending]) : 0;
    if (previous && lengthOf(pending) < minimumChunkCharacters && joined <= (previous.first ? firstChunkGrowthMaximum : maximumChunkCharacters)) previous.units.push(...pending);
    else flush();
  }
  return chunks.map(({ units }) => ({
    text: units.map((unit) => unit.text).join(" "),
    sentences: units.map((unit) => unit.caption).filter((caption, index, all) => index === 0 || caption !== all[index - 1]),
    units,
  }));
}

/** The synthesis chunk texts of an utterance, exactly as the client requests them. */
export function interviewerChunkTexts(utterance: string): string[] {
  return groupInterviewerSentences(splitInterviewerSpeech(utterance)).map((chunk) => chunk.text);
}

export function composeAcknowledgedQuestion(acknowledgement: string | null | undefined, question: string): string {
  return [acknowledgement?.trim(), question.trim()].filter(Boolean).join(" ");
}

export const ACKNOWLEDGEMENT_PHRASES = ["Okay.", "Got it.", "Alright.", "Mm-hm, okay.", "Thanks."];
export const ACKNOWLEDGEMENT_MIN_WORDS = 5;

/** Mirrors the client's closing lines (frontend speech-playback.mjs), so every variant is cached ahead of the interview. */
export const INTERVIEW_CLOSINGS: readonly string[] = [
  "That’s all the time we have today. Thanks for your answers. I’ll prepare your feedback now.",
  "We’re out of time, so let’s stop here. Thank you for talking with me. I’ll prepare your feedback now.",
  "Our time is up for today. Thanks for your time and your answers. I’ll get your feedback ready now.",
  "That’s the end of our time today. I appreciate your answers. Your feedback will be ready in a moment.",
  "We’ve reached the end of our time. Thanks for the conversation. I’ll prepare your feedback now.",
];

export function composeInterviewClosing(reaction: string | null = null, closing: string = INTERVIEW_CLOSINGS[0]): string {
  return [reaction?.trim(), closing.trim()].filter(Boolean).join(" ");
}

export function isAcknowledgeableAnswer(transcript: string): boolean {
  return (String(transcript ?? "").match(/[\p{L}\p{N}']+/gu) ?? []).length >= ACKNOWLEDGEMENT_MIN_WORDS;
}

const leadingAcknowledgement = /^(?:okay|ok|alright|all right|got it|gotcha|thanks|thank you|great|perfect|good|right|sure|understood|i see|mm-?hm+|mhm+|uh-?huh|cool|nice|excellent)\s*(?:[,.!;:—…-]+\s*|$)/iu;
const acknowledgementSentence = /^(?:thanks|thank you)(?: so much| a lot)?(?: for (?:that|this|sharing(?: that| this)?|the (?:example|details?|context|answer|explanation)|your (?:answer|example|explanation|time)))?\s*[.!]\s*|^(?:that|this) makes sense\s*[.!]\s*|^that'?s (?:helpful|great|clear|good|interesting)\s*[.!]\s*|^(?:let'?s|let us) (?:move on|continue|keep going)\s*[.!]\s*|^moving on\s*[.!]\s*/iu;

export function stripLeadingAcknowledgement(text: string | null | undefined): string {
  let rest = (text ?? "").trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const stripped = rest.replace(leadingAcknowledgement, "").replace(acknowledgementSentence, "").trim();
    if (stripped === rest) break;
    rest = stripped;
  }
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "";
}
