export type JobSeniority = "junior" | "mid-level" | "senior" | "staff";

export type JobDirection = {
  targetRole: string;
  suggestedSeniority: JobSeniority;
  mainInterviewEmphasis: string;
  priorityCompetencies: string[];
  productTeamContext: string;
  /** Up to three English questions tailored to the posting (optional). */
  tailoredQuestions?: string[];
};

export const maxTailoredQuestions: number;
export const maxJobTailoredQuestions: number;
export function isValidTailoredQuestion(value: unknown): value is string;
export const jobDescriptionMinLength: number;
export const jobDescriptionMaxLength: number;
export function isValidJobDirection(value: unknown): value is JobDirection;
export class JobDirectionRequestError extends Error {
  readonly code: string;
  readonly status: number;
}
export type JobFocus = "technical-depth" | "communication" | "behavioral" | "mixed";
export type JobDirectionAnalysis = JobDirection & { suggestedFocus?: JobFocus };
export type SetupMode = "manual" | "auto" | "resume";
type SetupConfig = { role: string; seniority: string; focus: string; jobDirection?: JobDirection };
export type SetupModeState<C extends SetupConfig = SetupConfig> = { mode: SetupMode; config: C; parkedDirection?: JobDirection };
export function requestJobDirection(jobDescription: string, roleContext: { targetRole: string; seniority?: string; focus?: string }, fetcher: typeof fetch, endpoint?: string): Promise<JobDirectionAnalysis>;
export function applyJobAnalysis<C extends SetupConfig>(config: C, analysis: JobDirectionAnalysis): C;
export function switchSetupMode<C extends SetupConfig>(state: SetupModeState<C>, mode: SetupMode): SetupModeState<C>;
export function setupModeBlocksStart(mode: SetupMode, jobDirection: JobDirection | undefined): boolean;
