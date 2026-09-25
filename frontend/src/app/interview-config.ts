import type { InterviewConfig } from "@/lib/interview/types";

export const defaultInterviewConfig: InterviewConfig = {
  role: "",
  seniority: "mid-level",
  focus: "technical-depth",
  duration: "15",
  questionCount: null,
  playInterviewerAudio: true,
  showQuestionCaptions: true,
  transcribeCandidateVoice: true,
  candidateCameraEnabled: false,
  autoCaptureVoice: true,
};
