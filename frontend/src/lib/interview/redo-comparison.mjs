const metric = (before, after) => Number.isFinite(before) && Number.isFinite(after) ? `${Math.round(before)} → ${Math.round(after)}` : null;
const seconds = (before, after) => Number.isFinite(before) && Number.isFinite(after) ? `${Math.round(before / 100) / 10}s → ${Math.round(after / 100) / 10}s` : null;

/** Compact, deterministic before/after lines for one voice redo attempt. */
export function buildRedoComparison(original, redo, patternCheck = []) {
  const originalDelivery = original?.delivery ?? {};
  const redoDelivery = redo?.delivery ?? {};
  const lines = [];
  const pace = metric(originalDelivery.wordsPerMinute, redoDelivery.wordsPerMinute);
  if (pace) lines.push({ kind: "pace", label: "Ritmo (palavras/min)", value: pace });
  const pauses = seconds(originalDelivery.longestPauseMs, redoDelivery.longestPauseMs);
  const fillers = metric(originalDelivery.fillerCount, redoDelivery.fillerCount);
  if (pauses || fillers) lines.push({ kind: "delivery", label: "Pausas longas / hesitações", pauses, fillers });
  const scoreBefore = original?.worstSentence?.score;
  const scoreAfter = redo?.worstSentence?.score;
  const score = metric(scoreBefore, scoreAfter);
  if (score && Number.isFinite(scoreBefore) && Number.isFinite(scoreAfter)) lines.push({ kind: "score", label: "Pronúncia do trecho", value: `${scoreBefore}/100 → ${scoreAfter}/100` });
  if (patternCheck.length) lines.push({ kind: "patterns", label: "Padrões de inglês", patterns: patternCheck });
  return lines.slice(0, 4);
}

export function appendRedoAttempt(attempts, attempt, max = 5) {
  return [...(Array.isArray(attempts) ? attempts : []), attempt].slice(-max);
}
