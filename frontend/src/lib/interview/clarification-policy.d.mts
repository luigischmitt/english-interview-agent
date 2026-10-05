export const maxClarificationsPerQuestion: number;
export const repeatSpeechSpeed: number;
export const repeatLeadIn: string;
export const rephraseLeadIn: string;
export const moveOnBridge: string;
export const maxDefinitionLength: number;
export const maxRephraseLength: number;
export function isClarificationDecision(decision: unknown): boolean;
export function canClarifyAgain(clarificationsSoFar: number): boolean;
export type ClarificationTurn = { acknowledgement: string; question: string; base: string; speed: number };
export function composeClarificationTurn(input: { decision: "REPEAT" | "REPHRASE" | "DEFINE"; clarificationText?: string | null; question: string }): ClarificationTurn;
export function assessmentContextKey(context: { sequenceNumber: number; round?: number }): string;
export function planTurnAfterDecision<T extends { decision: string }>(input: { decision: T; clarificationsSoFar: number; nextQuestion: string | null }): {
  countsAsAnswer: boolean;
  clarify: boolean;
  turn: T | { decision: "NEXT"; followUpQuestion: null; nextQuestion: string | null; acknowledgement: string };
  clarificationsAfter: number;
};
