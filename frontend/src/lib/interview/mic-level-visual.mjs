/** Maps the microphone's RMS level (0..1 float samples) to a 0..1 visual intensity for the candidate tile. */
export const silenceDb = -52;
export const loudDb = -22;
const attack = 0.55;
const release = 0.12;

export function levelToIntensity(level) {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const db = 20 * Math.log10(level);
  return Math.min(1, Math.max(0, (db - silenceDb) / (loudDb - silenceDb)));
}

/** Fast attack, slow release, so the ring follows speech without flicker. */
export function smoothIntensity(previous, target) {
  const rate = target > previous ? attack : release;
  const next = previous + (target - previous) * rate;
  return next < 0.01 && target === 0 ? 0 : next;
}
