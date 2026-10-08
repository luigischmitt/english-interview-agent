export type SpeculativePreparationCompatibility = "OPEN" | "COVERED" | "INVALID" | "NONE" | undefined;
export function canUseSpeculativePreparation(input: {
  value: { turnId: string; transcript: string; decision?: { decision?: string }; anchor: string | null } | null | undefined;
  finalTranscript: string;
  currentTurnId: string;
  featureEnabled: boolean;
  compatibility: SpeculativePreparationCompatibility;
}): boolean;
export function followUpSpeechReadyByAcknowledgement(input: {
  decision: { decision?: string } | null;
  speechReady: Promise<boolean> | null | undefined;
  audioEnabled: boolean;
  acknowledgementIdle: Promise<unknown>;
}): Promise<boolean>;
