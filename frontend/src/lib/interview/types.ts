export type InterviewConfig = {
  role: string;
  seniority: string;
  focus: string;
  duration: string;
  questionCount: string | null;
  playInterviewerAudio: boolean;
  showQuestionCaptions: boolean;
  candidateCameraEnabled: boolean;
  autoCaptureVoice: boolean;
  /** Input device chosen on the setup (opaque browser id); absent means the browser default. */
  microphoneDeviceId?: string | null;
};

export type InterviewQuestion = {
  id: string;
  prompt: string;
  cue: string;
};

export type InterviewAnswers = Record<string, string>;

export type InterviewTurnSpeaker = "interviewer" | "candidate";

export type InterviewTurn = {
  id: string;
  interviewId: string;
  sequenceNumber: number;
  speaker: InterviewTurnSpeaker;
  content: string | null;
  createdAt: string;
};

export type InterviewSessionStatus = "draft" | "in_progress" | "completed" | "abandoned";

export type InterviewSession = {
  id: string;
  userId: string;
  targetRole: string;
  seniority: string | null;
  focus: string | null;
  durationMinutes: number | null;
  questionCount: number | null;
  status: InterviewSessionStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; code?: string };

export type InterviewPhase = "introducing" | "speaking" | "answering" | "advancing" | "closing" | "ending";
