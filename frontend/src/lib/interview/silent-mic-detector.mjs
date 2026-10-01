export const deadInputLevel = 0.003;
export const deadInputAfterMs = 3_000;
export const noVoiceAfterMs = 10_000;

/**
 * Pure state machine for one capture attempt. Create it when the stream is
 * ready, feed it per-frame RMS levels and the server's speech-started signal,
 * and read `evaluate(now)`: "ok" | "silent" | "no_voice".
 * - silent: no frame reached `deadInputLevel` within `deadInputAfterMs`.
 * - no_voice: the server never reported speech within `noVoiceAfterMs`.
 * Once speech has started the detector never fires again.
 * @param {{ startedAtMs: number, deadInputLevel?: number, deadInputAfterMs?: number, noVoiceAfterMs?: number }} options
 */
export function createSilentMicDetector(options) {
  const level = options.deadInputLevel ?? deadInputLevel;
  const deadAfter = options.deadInputAfterMs ?? deadInputAfterMs;
  const noVoiceAfter = options.noVoiceAfterMs ?? noVoiceAfterMs;
  let startedAt = options.startedAtMs;
  let heardSignal = false;
  let speechStarted = false;

  return {
    pushLevel(value) {
      if (Number.isFinite(value) && value >= level) heardSignal = true;
    },
    markSpeechStarted() {
      speechStarted = true;
    },
    reset(nowMs) {
      startedAt = nowMs;
      heardSignal = false;
      speechStarted = false;
    },
    evaluate(nowMs) {
      if (speechStarted) return "ok";
      const elapsed = nowMs - startedAt;
      if (!heardSignal && elapsed >= deadAfter) return "silent";
      if (elapsed >= noVoiceAfter) return "no_voice";
      return "ok";
    },
  };
}
