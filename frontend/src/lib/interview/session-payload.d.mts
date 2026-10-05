import type { InterviewConfig } from "./types";

export function buildInterviewSessionPayload(config: InterviewConfig, userId: string, startedAt?: string): {
  user_id: string;
  target_role: string;
  seniority: string;
  focus: string;
  job_direction?: NonNullable<InterviewConfig["jobDirection"]>;
  duration_minutes: number;
  question_count: number | null;
  status: "in_progress";
  started_at: string;
};
