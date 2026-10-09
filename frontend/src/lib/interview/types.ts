import type { JobDirection } from "./job-direction.mjs";

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
  /** Interviewer voice (see lib/interview/voices.mjs); absent means the default, "am_echo". */
  voice?: string;
  /** User-approved job summary handed to the room; raw job description is never included. */
  jobDirection?: JobDirection;
  /** How the approved interview plan was created. The original job description or resume is never stored here. */
  interviewSource?: "manual" | "job" | "resume";
};

export type InterviewQuestion = {
  id: string;
  prompt: string;
  cue: string;
  coverage?: "broad-project";
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
  /** User-approved structured summary only; never contains the original job description. */
  jobDirection: JobDirection | null;
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
