const dimensions = ["accuracy", "fluency", "prosody"];

/** Summarize Azure scores without treating missing or unavailable results as zero. */
export function summarizeAzureAssessments(assessments) {
  const summary = {};
  for (const dimension of dimensions) {
    const values = assessments
      .filter((assessment) => assessment?.status === "available")
      .map((assessment) => ({ score: assessment.scores?.[dimension], weight: Number.isFinite(assessment.durationMs) && assessment.durationMs > 0 ? assessment.durationMs : 1 }))
      .filter(({ score }) => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100);
    summary[dimension] = {
      mean: values.length ? Math.round((values.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / values.reduce((sum, entry) => sum + entry.weight, 0)) * 10) / 10 : null,
      sampleCount: values.length,
    };
  }
  return summary;
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

/** Return the user's visible 1-based answer number for an internal turn sequence. */
export function answerOrdinalForSequence(turns, sequenceNumber) {
  const index = turns.findIndex((turn) => turn.sequenceNumber === sequenceNumber);
  return index < 0 ? null : index + 1;
}
