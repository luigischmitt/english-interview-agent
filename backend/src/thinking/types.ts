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

export type InterviewReportInput = {
  roleContext: InterviewThinkingInput["roleContext"];
  turns: Array<{ sequenceNumber: number; question: string; answer: string }>;
};

export type InterviewReport = {
  /** Safe aggregate counts only; optional for reports persisted before this field existed. */
  evidenceReview?: {
    technicalStrengths: InterviewReportEvidenceCounts;
    technicalGaps: InterviewReportEvidenceCounts;
    englishPatterns: InterviewReportEvidenceCounts;
    priorities: InterviewReportEvidenceCounts;
  };
  technicalContent: {
    summary: string;
    strengths: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
    gaps: Array<{ sequenceNumber: number; evidence: string; explanation: string }>;
  };
  englishCommunication: {
    clarity: CommunicationClarity;
    evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT" | "NO_PATTERN_FOUND" | "CANDIDATES_REJECTED";
    patterns: Array<{
      type: CommunicationObservationType;
      sequenceNumber: number;
      evidence: string;
      suggestion: string;
      rephrasedExample: string;
    }>;
  };
  priorities: Array<{
    area: "TECHNICAL_CONTENT" | "ENGLISH_COMMUNICATION";
    sequenceNumber: number;
    evidence: string;
    focus: string;
    exercise: string;
  }>;
};

export type InterviewReportEvidenceCounts = {
  candidates: number;
  accepted: number;
  rejected: number;
  /** Counts only, with no candidate text or other identifying data. */
  rejectionReasons?: { mismatch: number; invalidFormat: number; artifact: number; duplicate: number; limit: number };
};

export interface InterviewReportService {
  generate(input: InterviewReportInput): Promise<InterviewReport & { model: string; analysisVersion: "v2" }>;
}

export type InterviewOrchestrationInput = InterviewThinkingInput & {
  nextFixedQuestion: string | null;
  remainingFixedQuestions?: string[];
  followUpUsed: boolean;
  askedQuestions?: string[];
  recentAcknowledgements?: string[];
};

export type InterviewOrchestrationResult = {
  decision: "FOLLOW_UP" | "NEXT";
  followUpQuestion: string | null;
  nextQuestion: string | null;
  acknowledgement: string | null;
  diagnostics?: { model: string; latencyMs: number; costUsd: number | null };
};

export interface InterviewOrchestrationService {
  decide(input: InterviewOrchestrationInput): Promise<InterviewOrchestrationResult>;
}
