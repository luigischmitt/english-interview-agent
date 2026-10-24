export type DiffPart = { text: string; changed: boolean };

type ReportTextField = string | null | undefined;

export type ReportDocumentResult = {
  technicalContent?: { summary?: ReportTextField };
  overview?: { english?: ReportTextField };
  englishCommunication?: { patterns?: ReportDocumentPattern[] };
  turns?: Array<{ englishPatterns?: ReportDocumentPattern[] } | null | undefined>;
  priorities?: Array<{ area?: string; sequenceNumber?: number; focus?: ReportTextField } | null | undefined>;
};

export type ReportDocumentPattern = {
  type?: string;
  sequenceNumber?: number;
  evidence?: ReportTextField;
  suggestion?: ReportTextField;
  rephrasedExample?: ReportTextField;
  why?: ReportTextField;
};

export type ReportDocumentFinding = { vacancyCompetency?: ReportTextField } | null | undefined;

export type JobCoverageItem = { competency: string; status: "shown" | "partial" | "missing" };

export type ErrorRow = { type: string | undefined; sequenceNumber: number | undefined; said: DiffPart[]; right: DiffPart[]; note: string | null };

export type VoiceNoteKey = "accuracy" | "fluency" | "prosody";
export type VoiceNote = { key: VoiceNoteKey; label: string; measure: string; value: number | null };

export type PracticePriority = { title: string; area: "english" | "technical"; sequenceNumber: number | null; count: number | null };

export type VoiceSummary = Partial<Record<VoiceNoteKey, { mean?: number | null; sampleCount?: number } | null | undefined>> | null | undefined;

export function reportFileBase(role: string | null | undefined, date?: Date): string;
export function formatReportDate(value: Date | string | number | null | undefined, locale?: string, fallback?: Date): string;
export function reportSummaryText(result: ReportDocumentResult | null | undefined): string;
export function buildJobCoverage(competencies: readonly unknown[] | null | undefined, strengths?: ReportDocumentFinding[] | null, gaps?: ReportDocumentFinding[] | null): JobCoverageItem[];
export function buildErrorRows(patterns?: ReadonlyArray<ReportDocumentPattern | null | undefined> | null): ErrorRow[];
export function buildVoiceNotes(summary: VoiceSummary): VoiceNote[];
export function buildPracticePriorities(result: ReportDocumentResult | null | undefined): PracticePriority[];
