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

/** Findings for one answer, produced in the background during the interview. */
export type InterviewTurnAnalysis = {
  sequenceNumber: number;
  technicalStrengths: InterviewReport["technicalContent"]["strengths"];
  technicalGaps: InterviewReport["technicalContent"]["gaps"];
  englishPatterns: InterviewReport["englishCommunication"]["patterns"];
};

export type InterviewTurnAnalysisInput = {
  roleContext: InterviewThinkingInput["roleContext"];
  turn: InterviewReportInput["turns"][number];
};

export type InterviewReportConsolidationInput = InterviewReportInput & { turnAnalyses: InterviewTurnAnalysis[] };

export interface InterviewReportService {
  generate(input: InterviewReportInput): Promise<InterviewReport & { model: string; analysisVersion: "v2" }>;
  /** Analyze one answer; returns only server-validated items. */
  analyzeTurn(input: InterviewTurnAnalysisInput): Promise<InterviewTurnAnalysis & { model: string }>;
  /** Re-validate per-answer findings and produce the final report with one small call. */
  consolidate(input: InterviewReportConsolidationInput): Promise<InterviewReport & { model: string; analysisVersion: "v2" }>;
}

/** The kind of clarification request a deterministic detector found in a short candidate utterance. */
export const clarificationHints = ["repeat", "rephrase", "define"] as const;
export type ClarificationHint = (typeof clarificationHints)[number];
export type ClarificationDecision = "REPEAT" | "REPHRASE" | "DEFINE";

export type InterviewOrchestrationInput = InterviewThinkingInput & {
  /** Set by the client's deterministic detector; the candidate asked to hear/understand the question again, so this is not an answer. */
  clarificationHint?: ClarificationHint | null;
  nextFixedQuestion: string | null;
  remainingFixedQuestions?: string[];
  followUpUsed: boolean;
  askedQuestions?: string[];
  recentAcknowledgements?: string[];
  previousAnswers?: Array<{ question: string; answer: string }>;
};

export type InterviewOrchestrationResult = {
  decision: "FOLLOW_UP" | "NEXT" | ClarificationDecision;
  followUpQuestion: string | null;
  nextQuestion: string | null;
  acknowledgement: string | null;
  /** REPHRASE: the simpler question; DEFINE: a one-sentence explanation of the asked term; REPEAT or other decisions: absent. */
  clarificationText?: string | null;
  /** Who classified the utterance as a clarification request (content-free). */
  clarification?: "detector" | "model";
  diagnostics?: { model: string; latencyMs: number; costUsd: number | null };
};

export interface InterviewOrchestrationService {
  decide(input: InterviewOrchestrationInput): Promise<InterviewOrchestrationResult>;
}
