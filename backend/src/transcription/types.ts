export type TranscriptionResult = {
  transcript: string;
};

export interface TranscriptionService {
  transcribe(audio: Buffer): Promise<TranscriptionResult>;
}
