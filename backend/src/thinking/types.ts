export const answerStatuses = ["ADDRESSES_QUESTION", "PARTIAL", "UNCLEAR"] as const;
export const communicationClarities = ["CLEAR", "MOSTLY_CLEAR", "UNCLEAR"] as const;
export const communicationObservationTypes = ["GRAMMAR", "WORD_CHOICE", "FALSE_COGNATE", "STRUCTURE"] as const;

export type AnswerStatus = (typeof answerStatuses)[number];
export type CommunicationClarity = (typeof communicationClarities)[number];
export type CommunicationObservationType = (typeof communicationObservationTypes)[number];

export type InterviewThinkingInput = {
  currentQuestion: string;
  transcript: string;
  roleContext: {
    targetRole: string;
    seniority?: string;
    focus?: string;
  };
};

export type ThinkingAssessment = {
  answerStatus: AnswerStatus;
  needsClarification: boolean;
  technicalSummary: string;
  englishCommunication: {
    clarity: CommunicationClarity;
    observations: Array<{
      type: CommunicationObservationType;
      evidence: string;
      conciseSuggestion: string;
    }>;
  };
};

export interface ThinkingService {
  assess(input: InterviewThinkingInput): Promise<ThinkingAssessment>;
}
