export type InterviewerAudioMode = "audio" | "text";

export const defaultInterviewRoomPreferences: {
  playInterviewerAudio: boolean;
  showQuestionCaptions: boolean;
  candidateCameraEnabled: boolean;
};

export function getInterviewerAudioMode(config: { playInterviewerAudio: boolean }): InterviewerAudioMode;
export function withInterviewerAudioMode<T extends { playInterviewerAudio: boolean }>(config: T, mode: InterviewerAudioMode): T;
export function getInterviewSetupSummary(
  config: {
    role: string;
    seniority: string;
    focus: string;
    duration: string;
    interviewSource?: string;
    voice?: string;
    playInterviewerAudio: boolean;
    showQuestionCaptions: boolean;
    autoCaptureVoice: boolean;
    candidateCameraEnabled: boolean;
  },
  seniorityLabels: Record<string, string>,
  focusLabels: Record<string, string>,
): Array<{ label: string; value: string }>;
