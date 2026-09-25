import type { InterviewConfig } from "@/lib/interview/types";
import { defaultCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";

export const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  focus: "technical-depth",
  duration: "15",
  questionCount: null,
  playInterviewerAudio: true,
  showQuestionCaptions: true,
  ...defaultCandidateVoicePreferences,
  candidateCameraEnabled: false,
};
