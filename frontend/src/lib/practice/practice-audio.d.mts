import type { PracticeLesson } from "./practice-lessons.mjs";

export const PRACTICE_AUDIO_VOICE: string;
export const PRACTICE_AUDIO_DIR: string;
export function normalizePracticePhrase(text: string): string;
export function practiceAudioHash(text: string, voice?: string): string;
export function collectFixedPracticePhrases(lessons: PracticeLesson[]): string[];
export function staticPracticeAudioUrl(text: string, files: Record<string, string>): string | null;
