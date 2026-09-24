import { TranscriptionUnavailableError } from "./errors.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";

type AzureCandidate = {
  Display?: string;
};

type AzureSpeechResponse = {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: AzureCandidate[];
};

type AzureSpeechTranscriptionServiceOptions = {
  key: string;
  region: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
};

export class AzureSpeechTranscriptionService implements TranscriptionService {
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: AzureSpeechTranscriptionServiceOptions) {
    this.endpoint = `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    const transcription = await this.request(audio);
    const transcript = transcription.NBest?.[0]?.Display?.trim() || transcription.DisplayText?.trim();

    if (transcription.RecognitionStatus !== "Success" || !transcript) {
      throw new TranscriptionUnavailableError("Azure Speech could not recognize a response in this recording.");
    }

    return { transcript };
  }

  private async request(audio: Buffer): Promise<AzureSpeechResponse> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Ocp-Apim-Subscription-Key": this.options.key,
    };

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers,
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      if (!response.ok) {
        throw new TranscriptionUnavailableError(`Azure Speech returned HTTP ${response.status}.`);
      }

      return await response.json() as AzureSpeechResponse;
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      throw new TranscriptionUnavailableError("Azure Speech is unavailable right now.", { cause: error });
    }
  }
}
