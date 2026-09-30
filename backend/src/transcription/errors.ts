/** Fixed, content-free category of an upstream transcription failure. Never derived from provider response text. */
export type TranscriptionFailureCategory = "5xx" | "429" | "rejected" | "timeout" | "network" | "aborted" | "invalid_response" | "empty";

export type TranscriptionUnavailableErrorOptions = ErrorOptions & {
  providerStatus?: TranscriptionFailureCategory;
  /** HTTP attempts made before giving up. */
  attempts?: number;
};

export class TranscriptionUnavailableError extends Error {
  readonly providerStatus?: TranscriptionFailureCategory;
  readonly attempts?: number;

  constructor(message: string, options?: TranscriptionUnavailableErrorOptions) {
    super(message, options);
    this.name = "TranscriptionUnavailableError";
    this.providerStatus = options?.providerStatus;
    this.attempts = options?.attempts;
  }
}
