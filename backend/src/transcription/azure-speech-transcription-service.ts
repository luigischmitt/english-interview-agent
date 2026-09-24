import { TranscriptionUnavailableError } from "./errors.js";
import type { PronunciationAssessment, TranscriptionResult, TranscriptionService } from "./types.js";

type AzureWord = {
  Word?: string;
  AccuracyScore?: number;
  ErrorType?: string;
};

type AzureCandidate = {
  Display?: string;
  AccuracyScore?: number;
  FluencyScore?: number;
  ProsodyScore?: number;
  PronScore?: number;
  Words?: AzureWord[];
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

const emptyAssessment = (): PronunciationAssessment => ({
  accuracyScore: null,
  fluencyScore: null,
  prosodyScore: null,
  pronunciationScore: null,
  words: [],
});

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

    const assessment = await this.request(audio, transcript);
    return { transcript, assessment: this.toAssessment(assessment.NBest?.[0]) };
  }

  private async request(audio: Buffer, referenceText?: string): Promise<AzureSpeechResponse> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Ocp-Apim-Subscription-Key": this.options.key,
    };

    if (referenceText) {
      headers["Pronunciation-Assessment"] = Buffer.from(JSON.stringify({
        ReferenceText: referenceText,
        GradingSystem: "HundredMark",
        Granularity: "Word",
        Dimension: "Comprehensive",
        EnableProsodyAssessment: "True",
      })).toString("base64");
    }

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

  private toAssessment(candidate: AzureCandidate | undefined): PronunciationAssessment {
    if (!candidate) return emptyAssessment();

    return {
      accuracyScore: candidate.AccuracyScore ?? null,
      fluencyScore: candidate.FluencyScore ?? null,
      prosodyScore: candidate.ProsodyScore ?? null,
      pronunciationScore: candidate.PronScore ?? null,
      words: (candidate.Words ?? []).map((word) => ({
        word: word.Word ?? "",
        accuracyScore: word.AccuracyScore ?? null,
        errorType: word.ErrorType ?? null,
      })),
    };
  }
}
