export const transcriptionProviders = ["azure", "whisper-large-v3", "whisper-large-v3-turbo"] as const;

export type TranscriptionProvider = (typeof transcriptionProviders)[number];

export type TranscriptionResult = {
  provider: TranscriptionProvider;
  transcript: string;
  words?: TranscriptionWord[];
  segments?: TranscriptionWord[];
  /** Non-enumerable HTTP attempt count, present only when a retry happened. */
  attempts?: number;
  timingDiagnostics?: {
    wordFieldPresent: boolean;
    wordEntryCount: number;
    wordAcceptedCount: number;
    segmentFieldPresent: boolean;
    segmentEntryCount: number;
    segmentAcceptedCount: number;
  };
};

export type TranscriptionWord = { text: string; start: number; end: number; breakBefore?: boolean };

export type SegmentTimestampResult = { segments?: TranscriptionWord[] };

export type AudioFormat = "wav" | "webm" | "mp4";

/** Optional Whisper vocabulary-biasing context (question and earlier text of the same answer); never logged. */
export type TranscribeContext = { question?: string | null; previousText?: string };

export interface TranscriptionService {
  availableProviders(): TranscriptionProvider[];
  transcribe(audio: Buffer, provider: TranscriptionProvider, format?: AudioFormat, signal?: AbortSignal, context?: TranscribeContext): Promise<TranscriptionResult>;
  /** Optional, bounded recovery request used only when the primary transcript has no usable timing. */
  retrySegmentTimestamps?(audio: Buffer, provider: TranscriptionProvider, format?: AudioFormat, signal?: AbortSignal, context?: TranscribeContext): Promise<SegmentTimestampResult>;
}
