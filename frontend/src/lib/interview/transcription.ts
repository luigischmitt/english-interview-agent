export type TranscriptionProvider = "azure" | "whisper-large-v3" | "whisper-large-v3-turbo";

export type VoiceTranscription = {
  provider: TranscriptionProvider;
  transcript: string;
};
