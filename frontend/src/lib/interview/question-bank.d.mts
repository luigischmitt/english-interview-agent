export type QuestionTemplate = { id: string; prompt: string; cue: string };
export const genericQuestionBank: QuestionTemplate[];
export const questionBankRoles: string[];
export function getQuestionBankForRole(role: string | null | undefined): QuestionTemplate[];
