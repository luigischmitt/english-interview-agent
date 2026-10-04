import type { InterviewConfig } from "@/lib/interview/types";
import { defaultCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import { defaultInterviewRoomPreferences } from "@/lib/interview/setup-audio.mjs";
import { defaultTranscriptionEngine } from "@/lib/interview/transcription-engine.mjs";

export const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  focus: "technical-depth",
  duration: "15",
  questionCount: null,
  ...defaultCandidateVoicePreferences,
  ...defaultInterviewRoomPreferences,
  transcriptionEngine: defaultTranscriptionEngine,
};
