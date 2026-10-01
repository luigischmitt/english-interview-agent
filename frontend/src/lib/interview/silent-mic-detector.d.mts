export type SilentMicState = "ok" | "silent" | "no_voice";
export const deadInputLevel: number;
export const deadInputAfterMs: number;
export const noVoiceAfterMs: number;
export function createSilentMicDetector(options: { startedAtMs: number; deadInputLevel?: number; deadInputAfterMs?: number; noVoiceAfterMs?: number }): {
  pushLevel(value: number): void;
  markSpeechStarted(): void;
  reset(nowMs: number): void;
  evaluate(nowMs: number): SilentMicState;
};
