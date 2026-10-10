import type { InterviewerVoiceOption } from "./voices.mjs";

export const interviewerVoiceStorageKey: string;
export type VoicePickerItem = InterviewerVoiceOption & { name: string; traits: string; isDefault: boolean };
export type VoicePickerGroup = { gender: "male" | "female"; label: string; voices: VoicePickerItem[] };
export function voiceDisplayName(id: string): string;
export function voiceAccentLabel(accent: string): string;
export function voiceTraits(option: Pick<InterviewerVoiceOption, "gender" | "accent">): string;
export function voiceSummary(id: unknown): string;
export function groupVoicesByGender(options?: readonly InterviewerVoiceOption[]): VoicePickerGroup[];
export function voiceSamplePath(id: string): string;
export function readStoredInterviewerVoice(storage: Pick<Storage, "getItem">): string;
export function storeInterviewerVoice(storage: Pick<Storage, "setItem" | "removeItem">, voice: unknown): boolean;
export type VoiceSampleResult = { status: "completed" } | { status: "unavailable"; message: string } | { status: "cancelled" };
export function playVoiceSample(
  id: string,
  createAudio?: (src: string) => Pick<HTMLAudioElement, "play" | "pause" | "onended" | "onerror">,
): { promise: Promise<VoiceSampleResult>; cancel: () => void };
