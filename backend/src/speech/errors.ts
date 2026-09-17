export class SpeechProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpeechProviderUnavailableError";
  }
}
