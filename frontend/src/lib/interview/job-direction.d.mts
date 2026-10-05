export type JobSeniority = "junior" | "mid-level" | "senior" | "staff";

export type JobDirection = {
  targetRole: string;
  suggestedSeniority: JobSeniority;
  mainInterviewEmphasis: string;
  priorityCompetencies: string[];
  productTeamContext: string;
};

export const jobDescriptionMinLength: number;
export const jobDescriptionMaxLength: number;
export function isValidJobDirection(value: unknown): value is JobDirection;
export class JobDirectionRequestError extends Error {
  readonly code: string;
  readonly status: number;
}
export function requestJobDirection(jobDescription: string, roleContext: { targetRole: string; seniority?: string; focus?: string }, fetcher: typeof fetch, endpoint?: string): Promise<JobDirection>;
