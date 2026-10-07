import type { JobDirection, JobDirectionAnalysis } from "./job-direction.mjs";

export const resumeMaxBytes: number;
export class ResumeDirectionRequestError extends Error {
  readonly code: string;
  readonly status: number;
}
export function validateResumeFile(file: Pick<File, "name" | "size" | "type"> | null | undefined): string | null;
export function requestResumeDirection(
  file: File,
  fetcher: typeof fetch,
  endpoint?: string,
): Promise<JobDirectionAnalysis>;
export function updateResumeQuestion(direction: JobDirection, index: number, question: string): JobDirection;
export function removeResumeQuestion(direction: JobDirection, index: number): JobDirection;
