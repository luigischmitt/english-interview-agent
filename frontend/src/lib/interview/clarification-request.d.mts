export type ClarificationKind = "repeat" | "rephrase" | "define";
export const maxClarificationWords: number;
export function detectClarificationRequest(transcript: string): ClarificationKind | null;
