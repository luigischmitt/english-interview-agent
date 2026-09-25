/** @param {number[]} samples */
export function getSpeechThreshold(samples) {
  const noiseLevel = samples.length ? samples.reduce((sum, level) => sum + level, 0) / samples.length : 0;
  return Math.max(0.025, Math.min(0.15, noiseLevel * 2.5));
}

/** @param {number} speechThreshold */
export function getSilenceThreshold(speechThreshold) {
  return Math.max(0.012, Math.min(0.12, speechThreshold * 0.65));
}
