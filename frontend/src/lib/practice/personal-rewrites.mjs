import { applyEdits, toBlocks } from "./word-blocks.mjs";

const normalizeContractions = [
  [/\bcan't\b/gu, "cannot"], [/\bcant\b/gu, "cannot"],
  [/\bwon't\b/gu, "will not"], [/\bwont\b/gu, "will not"],
  [/\bdon't\b/gu, "do not"], [/\bdont\b/gu, "do not"],
  [/\bdoesn't\b/gu, "does not"], [/\bdoesnt\b/gu, "does not"],
  [/\bdidn't\b/gu, "did not"], [/\bdidnt\b/gu, "did not"],
  [/\bi'm\b/gu, "i am"], [/\bim\b/gu, "i am"],
  [/\bi've\b/gu, "i have"], [/\bive\b/gu, "i have"],
  [/\bi'll\b/gu, "i will"],
  [/\byou're\b/gu, "you are"], [/\byoure\b/gu, "you are"],
  [/\byou've\b/gu, "you have"], [/\byouve\b/gu, "you have"],
  [/\byou'll\b/gu, "you will"], [/\byoull\b/gu, "you will"],
  [/\bhe's\b/gu, "he is"], [/\bhes\b/gu, "he is"],
  [/\bshe's\b/gu, "she is"], [/\bshes\b/gu, "she is"],
  [/\bit's\b/gu, "it is"],
  [/\bwe're\b/gu, "we are"],
  [/\bwe've\b/gu, "we have"], [/\bweve\b/gu, "we have"],
  [/\bthey're\b/gu, "they are"], [/\btheyre\b/gu, "they are"],
  [/\bthey've\b/gu, "they have"], [/\btheyve\b/gu, "they have"],
  [/\bisn't\b/gu, "is not"], [/\bisnt\b/gu, "is not"],
  [/\baren't\b/gu, "are not"], [/\barent\b/gu, "are not"],
  [/\bwasn't\b/gu, "was not"], [/\bwasnt\b/gu, "was not"],
  [/\bweren't\b/gu, "were not"], [/\bwerent\b/gu, "were not"],
  [/\bhaven't\b/gu, "have not"], [/\bhavent\b/gu, "have not"],
  [/\bhasn't\b/gu, "has not"], [/\bhasnt\b/gu, "has not"],
  [/\bhadn't\b/gu, "had not"], [/\bhadnt\b/gu, "had not"],
  [/\bcouldn't\b/gu, "could not"], [/\bcouldnt\b/gu, "could not"],
  [/\bwouldn't\b/gu, "would not"], [/\bwouldnt\b/gu, "would not"],
  [/\bshouldn't\b/gu, "should not"], [/\bshouldnt\b/gu, "should not"],
];

/** Normalize only surface differences; personal rewrites do not accept semantic paraphrases. */
export function normalizePersonalAnswer(value) {
  let normalized = String(value ?? "").toLocaleLowerCase("en-US").replace(/[’‘]/gu, "'");
  for (const [pattern, replacement] of normalizeContractions) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/\p{P}/gu, " ").replace(/\s+/gu, " ").trim();
}

function candidateFrom(ref, lesson, target, index) {
  const lessonKey = target.lessonKey ?? target.category ?? ref.lessonKey ?? lesson?.key;
  const lessonForTarget = lesson;
  const ruleId = target.ruleId ?? ref.ruleId;
  const targetLesson = lessonForTarget?.key === lessonKey ? lessonForTarget : null;
  const validRule = targetLesson?.rules?.some((rule) => rule.id === ruleId);
  const rule = targetLesson?.rules?.find((item) => item.id === ruleId);
  const evidence = String(target.sourceEvidence ?? target.evidence ?? ref.evidence ?? "").trim();
  const corrected = String(target.correctedTarget ?? target.target ?? target.rephrased ?? ref.rephrased ?? "").trim();
  if (!targetLesson || !validRule || !evidence || !corrected || evidence.length > 500 || corrected.length > 500) return null;
  if (normalizePersonalAnswer(evidence) === normalizePersonalAnswer(corrected)) return null;
  const acceptedAnswers = Array.isArray(target.acceptedAnswers)
    ? target.acceptedAnswers.filter((answer) => typeof answer === "string").map((answer) => answer.trim()).filter((answer) => answer && answer.length <= 500).slice(0, 5)
    : [];
  const interviewId = String(target.interview_id ?? ref.interview_id ?? "");
  const sequence = target.sequence_number ?? ref.sequence_number ?? index;
  const fingerprint = `${normalizePersonalAnswer(evidence)}>${normalizePersonalAnswer(corrected)}`;
  let hash = 2166136261;
  for (const character of fingerprint) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const isPlanTarget = Boolean(target.correctedTarget ?? target.target);
  const id = String(target.id ?? `personal:${lessonKey}:${ruleId}:${interviewId}:${isPlanTarget ? (hash >>> 0).toString(36) : sequence}`);
  const accepted = [...new Set([corrected, ...acceptedAnswers].filter((answer) => normalizePersonalAnswer(answer)))];
  const latestAt = String(target.created_at ?? ref.created_at ?? "");
  return {
    id,
    lessonKey,
    ruleId,
    kind: "personal",
    sentence: evidence,
    answer: corrected,
    accepted,
    context: String(target.context ?? target.explanation ?? target.why ?? (ref.suggestion?.trim() || rule.when)).trim(),
    why: String(target.why ?? target.explanation ?? ref.suggestion ?? "").trim() || null,
    interviewId,
    latestAt,
    planned: isPlanTarget,
  };
}

function targetsFromRef(ref) {
  if (ref?.studyPlanTarget && typeof ref.studyPlanTarget === "object") return [ref.studyPlanTarget];
  const nested = ref?.studyPlan?.targets ?? ref?.study_plan?.targets;
  if (Array.isArray(nested)) return nested.filter((target) => target && typeof target === "object");
  if (ref && typeof ref === "object" && (ref.target || ref.rephrased)) return [ref];
  return [];
}

/** Build up to three own-phrase rewrites, one per rule, favoring repeated and recent refs. */
export function buildPersonalRewriteTargets(groups, lessons, recentIds = [], limit = 3) {
  const lessonsByKey = new Map((lessons ?? []).map((lesson) => [lesson.key, lesson]));
  const recent = new Set(recentIds ?? []);
  const candidates = [];
  for (const group of groups ?? []) {
    for (const [index, ref] of (group.error_refs ?? []).entries()) {
      for (const target of targetsFromRef(ref)) {
        const lessonKey = target.lessonKey ?? target.category ?? ref.lessonKey ?? group.theme_key;
        const candidate = candidateFrom(ref, lessonsByKey.get(lessonKey), target, index);
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const byRule = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.lessonKey}:${candidate.ruleId}`;
    const existing = byRule.get(key) ?? { candidates: [], interviews: new Set() };
    existing.candidates.push(candidate);
    if (candidate.interviewId) existing.interviews.add(candidate.interviewId);
    byRule.set(key, existing);
  }

  return [...byRule.values()]
    .map(({ candidates: options, interviews }) => {
      const available = options.filter((candidate) => !recent.has(candidate.id));
      if (!available.length) return null;
      available.sort((a, b) => Number(b.planned) - Number(a.planned) || b.latestAt.localeCompare(a.latestAt) || b.id.localeCompare(a.id));
      return { candidate: available[0], repeats: interviews.size };
    })
    .filter(Boolean)
    .sort((a, b) => b.repeats - a.repeats || b.candidate.latestAt.localeCompare(a.candidate.latestAt))
    .slice(0, Math.max(0, Math.min(3, limit)))
    .map(({ candidate }) => ({
      id: candidate.id,
      lessonKey: candidate.lessonKey,
      ruleId: candidate.ruleId,
      kind: candidate.kind,
      sentence: candidate.sentence,
      answer: candidate.answer,
      accepted: candidate.accepted,
      context: candidate.context,
      why: candidate.why,
    }));
}

/** Exact local grading for individual rewrites; only supplied wording variants are accepted. */
export function gradePersonalRewrite(exercise, answer) {
  const accepted = [exercise.answer, ...(exercise.accepted ?? [])];
  const correct = accepted.some((candidate) => normalizePersonalAnswer(candidate) === normalizePersonalAnswer(answer));
  return { verdict: correct ? "correct" : "incorrect", corrected: exercise.answer, feedback: correct ? "correct" : "incorrect" };
}

/** Return every corrected-phrase token in a stable shuffled order for a no-prefill word bank. */
export function shuffledPersonalWordBank(sentence, seed = "") {
  const blocks = toBlocks(sentence);
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const tokens = [...blocks];
  for (let index = tokens.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [tokens[index], tokens[swapIndex]] = [tokens[swapIndex], tokens[index]];
  }
  if (tokens.length > 1 && tokens.every((token, index) => token.id === blocks[index].id)) {
    [tokens[0], tokens[1]] = [tokens[1], tokens[0]];
  }
  return tokens;
}

/** Rebuild a full bank selection with the target's original punctuation. */
export function composePersonalWordBank(sentence, order) {
  return applyEdits(toBlocks(sentence), {}, order);
}
