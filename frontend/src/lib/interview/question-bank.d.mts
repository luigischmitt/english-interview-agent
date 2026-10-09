export type QuestionCoverage = "broad-project";
export type QuestionTemplate = { id: string; prompt: string; cue: string; coverage?: QuestionCoverage };
export const genericQuestionBank: QuestionTemplate[];
export const genericJuniorQuestionBank: QuestionTemplate[];
export const questionBankRoles: string[];
export function getQuestionBankForRole(role: string | null | undefined, seniority?: string | null): QuestionTemplate[];
