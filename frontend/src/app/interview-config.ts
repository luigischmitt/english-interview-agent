import type { InterviewConfig } from "@/lib/interview/types";
import { DEFAULT_INTERVIEWER_VOICE } from "@/lib/interview/voices.mjs";
import { defaultCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import { defaultInterviewRoomPreferences } from "@/lib/interview/setup-audio.mjs";

export const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  voice: DEFAULT_INTERVIEWER_VOICE,
  focus: "technical-depth",
  duration: "15",
  questionCount: null,
  ...defaultCandidateVoicePreferences,
  ...defaultInterviewRoomPreferences,
};
