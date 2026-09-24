import type { TranscriptionConfig } from "./config.js";
import { AzurePronunciationAssessmentService, type PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";

export function createPronunciationAssessmentService(config: TranscriptionConfig): PronunciationAssessmentService | null {
  if (!config.assessmentEnabled || !config.azureSpeechKey || !config.azureSpeechRegion) return null;
  return new AzurePronunciationAssessmentService({ key: config.azureSpeechKey, region: config.azureSpeechRegion, timeoutMs: config.assessmentTimeoutMs });
}
