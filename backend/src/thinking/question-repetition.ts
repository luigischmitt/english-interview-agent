// Deterministic guard against back-to-back questions that reuse the same theme, action or verb pattern
// (for example "How did you integrate X?" followed by "How did you integrate Y?").
import { questionStopWords } from "./interview-text.js";

/** Only the most recent questions matter for pattern repetition; older coverage is handled by the asked-question check. */
export const recentQuestionWindow = 2;

const extraStopWords = [
  "walk", "through", "tell", "describe", "explain", "give", "example", "time", "can", "could", "would", "should", "does", "you", "your", "me", "us", "we", "our",
  "this", "these", "those", "into", "over", "project", "application", "app", "system", "specific", "specifically", "briefly", "detail", "details", "exactly", "also",
  "any", "been", "being", "ever", "more", "some", "just", "make", "made", "mentioned", "said", "earlier", "talked", "talk", "told", "interesting", "next", "now",
  "same", "then", "than", "them", "they", "their", "its", "not", "one", "ones", "way", "ways", "kind", "sort", "part",
];
const stopWords = new Set([...questionStopWords, ...extraStopWords]);

/** Irregular forms and near-synonyms of the verbs interviewers repeat most; everything else uses suffix stripping. */
const canonicalWords: Record<string, string> = {
  built: "build", building: "build", builds: "build", create: "build", created: "build", creating: "build", develop: "build", developed: "build", developing: "build",
  implement: "build", implemented: "build", implementing: "build", implementation: "build", set: "build", setup: "build",
  chose: "choose", chosen: "choose", choice: "choose", led: "lead", ran: "run", wrote: "write", written: "write", took: "take", taken: "take", went: "go", gone: "go",
  fixed: "fix", solved: "solve", handled: "handle", handling: "handle", dealt: "deal", faced: "face", facing: "face",
};

function stem(word: string): string {
  const canonical = canonicalWords[word];
  if (canonical) return trimFinalE(canonical);
  let value = word;
  if (value.endsWith("ies") && value.length > 4) value = `${value.slice(0, -3)}y`;
  else if (value.endsWith("ions") && value.length > 6) value = value.slice(0, -4);
  else if (value.endsWith("ion") && value.length > 5) value = value.slice(0, -3);
  else if (value.endsWith("ing") && value.length > 5) value = value.slice(0, -3);
  else if (value.endsWith("ed") && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith("es") && value.length > 4) value = value.slice(0, -2);
  else if (value.endsWith("s") && !value.endsWith("ss") && value.length > 3) value = value.slice(0, -1);
  return trimFinalE(canonicalWords[value] ?? value);
}

function trimFinalE(value: string): string {
  return value.length > 4 && value.endsWith("e") ? value.slice(0, -1) : value;
}

/** Ordered content-word stems: lowercase, punctuation and accents stripped, stop words dropped, light stemming. */
export function questionStems(question: string): string[] {
  const words = question.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => word.length > 2 && !stopWords.has(word)).map(stem);
}

export type RepetitionReason = "shared_verb" | "shared_lead" | "high_overlap";

/** Verbs after "you" that carry no topic of their own ("what did you make", "you mentioned"), so they never count as the repeated action. */
const genericVerbs = new Set(["make", "made", "have", "has", "had", "get", "got", "take", "took", "use", "used", "think", "know", "want", "need", "mean", "mentioned", "said", "talked", "told", "ever", "usually", "typically", "actually", "first", "also", "still", "really", "currently", "personally", "see", "feel", "say", "tell", "would", "could", "can", "should", "will", "might", "must", "did", "does", "do", "are", "were", "was", "been"]);

/** The main action verb of the question: the first non-generic word right after "you" ("How did you integrate ..." gives "integrat"). */
export function mainVerb(question: string): string | null {
  const words = question.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    if (words[index] !== "you") continue;
    const verb = words[index + 1];
    if (verb.length < 4 || genericVerbs.has(verb)) continue;
    return stem(verb);
  }
  return null;
}

/** Thresholds tuned on the unit-test examples: overlap/jaccard apply only with at least two shared stems. */
const minSharedStems = 2;
const overlapThreshold = 0.6;
const jaccardThreshold = 0.5;
const leadWords = 4;

/** Why `candidate` repeats `earlier` (same leading verb/topic template, or mostly the same content words); null when distinct. */
export function questionRepetition(candidate: string, earlier: string, checkTopicOverlap = true): RepetitionReason | null {
  const a = questionStems(candidate);
  const b = questionStems(earlier);
  if (a.length === 0 || b.length === 0) return null;
  const verbA = mainVerb(candidate);
  if (verbA !== null && verbA === mainVerb(earlier)) return "shared_verb";
  if (a.length >= leadWords && b.length >= leadWords && a.slice(0, leadWords).every((word, index) => word === b[index])) return "shared_lead";
  // A follow-up legitimately stays on the topic of the question it digs into; only its phrasing may not repeat.
  if (!checkTopicOverlap) return null;
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((word) => setB.has(word)).length;
  if (shared < minSharedStems) return null;
  const overlap = shared / Math.min(setA.size, setB.size);
  const jaccard = shared / (setA.size + setB.size - shared);
  return overlap >= overlapThreshold || jaccard >= jaccardThreshold ? "high_overlap" : null;
}

/** Compares a proposed question with the last `recentQuestionWindow` asked questions. */
export function repeatsRecentQuestion(candidate: string, askedQuestions: readonly string[] = [], checkTopicOverlap = true): RepetitionReason | null {
  for (const earlier of askedQuestions.slice(-recentQuestionWindow)) {
    const reason = questionRepetition(candidate, earlier, checkTopicOverlap);
    if (reason) return reason;
  }
  return null;
}
