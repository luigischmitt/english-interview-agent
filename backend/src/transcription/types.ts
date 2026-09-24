export type PronunciationWord = {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
};

export type PronunciationAssessment = {
  accuracyScore: number | null;
  fluencyScore: number | null;
  prosodyScore: number | null;
  pronunciationScore: number | null;
  words: PronunciationWord[];
};

export type TranscriptionResult = {
  transcript: string;
  assessment: PronunciationAssessment;
};

export interface TranscriptionService {
  transcribe(audio: Buffer): Promise<TranscriptionResult>;
}
