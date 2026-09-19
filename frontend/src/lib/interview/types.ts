export type InterviewConfig = {
  role: string;
  seniority: string;
  focus: string;
  duration: string;
  questionCount: string;
};

export type InterviewQuestion = {
  id: string;
  prompt: string;
  cue: string;
};

export type InterviewAnswers = Record<string, string>;

export type InterviewPhase = "speaking" | "answering" | "advancing" | "ending";
