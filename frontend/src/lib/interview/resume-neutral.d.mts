export const RESUME_PRACTICE_LABEL: string;
export const RESUME_NEUTRAL_ROLE: string;
export function isResumePractice(config: { interviewSource?: string } | null | undefined): boolean;
export function buildRoleContext(config: { role: string; seniority: string; focus: string; interviewSource?: string }): { targetRole: string; seniority?: string; focus?: string };
