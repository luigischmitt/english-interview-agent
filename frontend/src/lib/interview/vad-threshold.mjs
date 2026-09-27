/** @param {number[]} samples */
export function getSpeechThreshold(samples) {
  if (!samples.length) return 0.015;
  // The initial calibration can overlap the candidate's first words. Ignore a
  // single low outlier so a transient dropout is not mistaken for the noise floor.
  const ordered = [...samples].filter(Number.isFinite).sort((left, right) => left - right);
  const noiseLevel = ordered[Math.min(1, ordered.length - 1)] ?? 0;
  // If every calibration frame is elevated, speech may have contaminated the
  // sample. Use the conservative voice threshold rather than treating speech
  // as room noise. Otherwise cap the estimate so one noisy burst cannot make
  // ordinary speech undetectable.
  if (noiseLevel >= 0.025) return 0.025;
  return Math.max(0.015, Math.min(0.05, noiseLevel * 1.25));
}

/** @param {number} speechThreshold */
export function getSilenceThreshold(speechThreshold) {
  return Math.max(0.008, Math.min(0.08, speechThreshold * 0.55));
}
