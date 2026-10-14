export type LearnerQuestionTopic = { topicId: string; sessionCount: number; lastSeenAt: number };
export type TechnicalQuestionTopicSnapshot = { sequenceNumber: number; topicId: string };
export function buildLearnerQuestionProfile(records: unknown, targetRole?: string): LearnerQuestionTopic[];
export function personalizeTechnicalQuestions<T extends { id: string; prompt: string; cue: string; topicId?: string }>(questions: T[], profile: Array<{ topicId: string; sessionCount: number }>, options?: { seniority?: string }): T[];
export function createTechnicalQuestionSnapshot(questions: Array<{ id: string; prompt: string; topicId?: string }>, turns: Array<{ sequenceNumber: number; question: string }>): TechnicalQuestionTopicSnapshot[];
export function countPriorTopicGaps(records: unknown, targetRole: string | undefined, topicId: string, currentInterviewId?: string): number;
export function reportTechnicalFocus(report: unknown, records: unknown, targetRole: string | undefined, currentInterviewId?: string): { focus: string; priorSessionCount: number } | null;
