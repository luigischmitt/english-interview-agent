export type InterviewerVoiceOption = { id: string; gender: "male" | "female"; accent: "US" | "UK" };
export const DEFAULT_INTERVIEWER_VOICE: string;
export const INTERVIEWER_VOICE_OPTIONS: readonly InterviewerVoiceOption[];
export const INTERVIEWER_VOICES: readonly string[];
export function resolveInterviewerVoice(voice: unknown): string;
