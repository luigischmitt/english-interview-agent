import type { InterviewConfig } from "@/lib/interview/types";
import { DEFAULT_INTERVIEWER_VOICE } from "@/lib/interview/voices.mjs";
import { DEFAULT_INTERVIEWER_SPEECH_SPEED } from "@/lib/interview/interviewer-speech-speed.mjs";
import { defaultCandidateVoicePreferences } from "@/lib/interview/candidate-voice-preferences.mjs";
import { defaultInterviewRoomPreferences } from "@/lib/interview/setup-audio.mjs";

export const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  voice: DEFAULT_INTERVIEWER_VOICE,
  speechSpeed: DEFAULT_INTERVIEWER_SPEECH_SPEED,
  focus: "technical-depth",
  duration: "15",
  questionCount: null,
  ...defaultCandidateVoicePreferences,
  ...defaultInterviewRoomPreferences,
  showInterviewerCharacter: true,
};
