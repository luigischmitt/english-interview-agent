import { createAudioToWav, type AudioConverter } from "./audio-to-wav.js";
import type { AudioFormat } from "./types.js";

export type PronunciationScores = { accuracy: number | null; fluency: number | null; prosody: number | null };
export type PronunciationAssessment = { provider: "azure"; locale: "en-US"; mode: "scripted"; scores: PronunciationScores };
type AzureCandidate = {
  AccuracyScore?: number;
  FluencyScore?: number;
  ProsodyScore?: number;
  PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; ProsodyScore?: number };
};
type AzureResponse = { RecognitionStatus?: string; NBest?: AzureCandidate[] };

async function withinDeadline<T>(operation: Promise<T>, deadline: number, onDeadline?: () => void): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("Azure pronunciation assessment timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onDeadline?.();
          reject(new Error("Azure pronunciation assessment timed out"));
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PronunciationAssessmentService {
  assess(audio: Buffer, format: AudioFormat, referenceText: string): Promise<PronunciationAssessment>;
}

export class AzurePronunciationAssessmentService implements PronunciationAssessmentService {
  private readonly convert: AudioConverter;
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: { key: string; region: string; timeoutMs: number; convert?: AudioConverter; fetchImplementation?: typeof fetch }) {
    this.convert = options.convert ?? createAudioToWav({ timeoutMs: options.timeoutMs });
    this.fetcher = options.fetchImplementation ?? fetch;
    this.endpoint = `https://${options.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  }

  async assess(audio: Buffer, format: AudioFormat, referenceText: string): Promise<PronunciationAssessment> {
    if (!referenceText.trim()) throw new Error("Azure pronunciation assessment requires reference text");
    const deadline = Date.now() + this.options.timeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    const wav = await withinDeadline(this.convert(audio, format, remaining()), deadline);
    const requestBudget = remaining();
    if (requestBudget <= 0) throw new Error("Azure pronunciation assessment timed out");

    const assessmentHeader = Buffer.from(JSON.stringify({
      ReferenceText: referenceText,
      GradingSystem: "HundredMark",
      Granularity: "Word",
      Dimension: "Comprehensive",
      EnableProsodyAssessment: "True",
    })).toString("base64");
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), requestBudget);
    const abortRequest = () => controller.abort();
    try {
      const response = await withinDeadline(this.fetcher(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          "Ocp-Apim-Subscription-Key": this.options.key,
          "Pronunciation-Assessment": assessmentHeader,
        },
        body: new Uint8Array(wav),
        signal: controller.signal,
      }), deadline, abortRequest);
      if (remaining() <= 0) throw new Error("Azure pronunciation assessment timed out");
      if (!response.ok) throw new Error("Azure pronunciation assessment unavailable");
      const result = await withinDeadline(response.json() as Promise<AzureResponse>, deadline, abortRequest);
      if (remaining() <= 0) throw new Error("Azure pronunciation assessment timed out");
      if (result.RecognitionStatus !== "Success") throw new Error("Azure pronunciation assessment unavailable");

      const candidate = result.NBest?.[0];
      const raw = candidate?.PronunciationAssessment ?? candidate;
      const score = (value: number | undefined) => Number.isFinite(value) && value! >= 0 && value! <= 100 ? value! : null;
      const scores = { accuracy: score(raw?.AccuracyScore), fluency: score(raw?.FluencyScore), prosody: score(raw?.ProsodyScore) };
      if (Object.values(scores).every((value) => value === null)) throw new Error("Azure pronunciation assessment unavailable");
      return { provider: "azure", locale: "en-US", mode: "scripted", scores };
    } finally {
      if (Date.now() >= deadline && !controller.signal.aborted) controller.abort();
      clearTimeout(abortTimer);
    }
  }
}
