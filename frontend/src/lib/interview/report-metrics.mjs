const dimensions = ["accuracy", "fluency", "prosody"];

/** Below this much assessed speech a dimension is too noisy to show as a number. */
export const insufficientAzureAudioMs = 5_000;
/** Below this much assessed speech a dimension is shown with an explicit low-confidence note. */
export const limitedAzureAudioMs = 20_000;

const hasValidDuration = (assessment) => Number.isFinite(assessment.durationMs) && assessment.durationMs > 0;

/**
 * Summarize Azure scores without treating missing or unavailable results as zero.
 * Each answer's score is weighted by its assessed speech duration. When any contributing answer has no valid
 * duration, every answer counts equally instead (a missing duration must not silently shrink an answer to ~0 weight).
 * `sampleCount` counts answers (not blocks); `totalDurationMs` is the assessed speech behind the mean, or null when unknown.
 */
export function summarizeAzureAssessments(assessments) {
  const summary = {};
  for (const dimension of dimensions) {
    const values = assessments
      .filter((assessment) => assessment?.status === "available")
      .map((assessment) => ({ score: assessment.scores?.[dimension], durationMs: hasValidDuration(assessment) ? assessment.durationMs : null }))
      .filter(({ score }) => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100);
    const durationKnown = values.length > 0 && values.every(({ durationMs }) => durationMs !== null);
    const weightOf = ({ durationMs }) => durationKnown ? durationMs : 1;
    const totalWeight = values.reduce((sum, entry) => sum + weightOf(entry), 0);
    summary[dimension] = {
      mean: values.length ? Math.round((values.reduce((sum, entry) => sum + entry.score * weightOf(entry), 0) / totalWeight) * 10) / 10 : null,
      sampleCount: values.length,
      totalDurationMs: durationKnown ? totalWeight : null,
    };
  }
  return summary;
}

/**
 * How much a dimension's mean can be trusted, from the assessed speech behind it.
 * "none": no score. "insufficient": too little audio, hide the number. "limited": show it with a caution.
 * "ok": enough audio (still an experimental signal). Summaries saved before ENG-113 have no duration and are "limited".
 */
export function azureMetricReliability(metric) {
  if (!metric || metric.mean === null || metric.sampleCount === 0) return "none";
  if (typeof metric.totalDurationMs !== "number") return "limited";
  if (metric.totalDurationMs < insufficientAzureAudioMs) return "insufficient";
  if (metric.totalDurationMs < limitedAzureAudioMs) return "limited";
  return "ok";
}

/** Match each candidate response with the nearest preceding interviewer question. */
export function pairInterviewTurns(turns) {
  const ordered = [...turns].sort((first, second) => first.sequenceNumber - second.sequenceNumber);
  const result = [];
  let question = null;
  for (const turn of ordered) {
    if (turn.speaker === "interviewer") {
      question = turn;
    } else if (turn.content?.trim() && question?.content?.trim()) {
      result.push({ sequenceNumber: question.sequenceNumber, question: question.content.trim(), answer: turn.content.trim() });
      question = null;
    }
  }
  return result;
}

/** Add a submitted answer pair immediately so lifecycle callbacks can snapshot the latest turns. */
export function appendInterviewReportPair(turns, { questionSequenceNumber, candidateSequenceNumber, question, answer }) {
  return [
    ...turns,
    { sequenceNumber: questionSequenceNumber, speaker: "interviewer", content: question },
    { sequenceNumber: candidateSequenceNumber, speaker: "candidate", content: answer },
  ];
}

/** Return the user's visible 1-based answer number for an internal turn sequence. */
export function answerOrdinalForSequence(turns, sequenceNumber) {
  const index = turns.findIndex((turn) => turn.sequenceNumber === sequenceNumber);
  return index < 0 ? null : index + 1;
}
