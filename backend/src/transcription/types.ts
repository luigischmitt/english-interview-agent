export const transcriptionProviders = ["azure", "whisper-large-v3", "whisper-large-v3-turbo"] as const;

export type TranscriptionProvider = (typeof transcriptionProviders)[number];

export type TranscriptionResult = {
  provider: TranscriptionProvider;
  transcript: string;
};

export type AudioFormat = "wav" | "webm" | "mp4";

export interface TranscriptionService {
  availableProviders(): TranscriptionProvider[];
  transcribe(audio: Buffer, provider: TranscriptionProvider, format?: AudioFormat): Promise<TranscriptionResult>;
}
