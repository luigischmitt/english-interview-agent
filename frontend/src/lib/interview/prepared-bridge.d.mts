export const MAX_POST_FOLLOW_UP_ANALYSES: number;
export function bridgeForSelection(input: { bridge?: string | null; bridgeFor?: string | null; originalPrompt?: string | null }): string | null;
export function createPreparedBridgeRegistry(): {
  offer(input: {
    turnId: string;
    revision: number;
    speechEpoch: number;
    bridge: string;
    prompt: string;
    utterance: string;
    prewarm?: (utterance: string) => { firstChunkReady: Promise<boolean>; cancel: () => void } | null;
  }): boolean;
  find(input: { turnId: string; speechEpoch: number | null; prompt: string; utteranceFor?: (bridge: string) => string }): string | null;
  clear(): void;
};
export function canUsePostFollowUpPreparation(input: {
  value: { turnId?: string; speechEpoch?: number; transcript?: string; decision?: { decision?: string; nextQuestion?: string | null } | null } | null | undefined;
  currentTurnId: string;
  currentSpeechEpoch: number | null;
  finalTranscript: string;
}): boolean;
