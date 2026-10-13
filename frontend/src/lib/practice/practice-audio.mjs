/**
 * Fixed Treinar phrases (rule examples, traps, quick checks, corrected choose sentences) are synthesized once by
 * scripts/generate-practice-audio.ts, always with the single lesson voice below, and served as static files. The lesson
 * audio therefore does NOT follow the interviewer voice the candidate picked in the setup screen.
 */
export const PRACTICE_AUDIO_VOICE = "am_echo";
export const PRACTICE_AUDIO_DIR = "/audio/practice";

/** Whitespace-normalized text, so " It depends on  X. " and "It depends on X." share one file. */
export function normalizePracticePhrase(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

const encoder = new TextEncoder();

function fnv1a32(bytes, seed) {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Small synchronous hash (two seeded FNV-1a 32-bit passes = 16 hex chars) shared by the generator script and the browser. */
export function practiceAudioHash(text, voice = PRACTICE_AUDIO_VOICE) {
  const bytes = encoder.encode(`${voice}\n${normalizePracticePhrase(text)}`);
  const parts = [fnv1a32(bytes, 0x811c9dc5), fnv1a32(bytes, 0x9747b28c)];
  return parts.map((part) => part.toString(16).padStart(8, "0")).join("");
}

/** Every fixed English phrase a speaker button can play in Treinar, normalized and deduplicated. */
export function collectFixedPracticePhrases(lessons) {
  const phrases = new Set();
  const add = (text) => {
    const clean = normalizePracticePhrase(text);
    if (clean) phrases.add(clean);
  };
  for (const lesson of lessons) {
    for (const rule of lesson.rules) {
      add(rule.right);
      for (const example of rule.examples ?? []) add(example.en);
      for (const trap of rule.traps ?? []) add(trap.right);
    }
    for (const exercise of lesson.exercises) {
      if (exercise.kind === "choose") add(exercise.sentence.replace("___", exercise.answer));
      // A locally-correct spot/fix answer is echoed back as the corrected sentence.
      else for (const candidate of [exercise.answer, ...(exercise.accepted ?? [])]) add(candidate);
    }
  }
  return [...phrases];
}

/** "/audio/practice/<file>" when the phrase has a pre-generated file, else null; `files` is the manifest's hash -> file map (dynamic text goes to the speech API). */
export function staticPracticeAudioUrl(text, files) {
  const clean = normalizePracticePhrase(text);
  if (!clean) return null;
  const file = files[practiceAudioHash(clean)];
  return file ? `${PRACTICE_AUDIO_DIR}/${file}` : null;
}
