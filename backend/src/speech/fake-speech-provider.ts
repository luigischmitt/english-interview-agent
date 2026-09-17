import type {
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "./types.js";

export class FakeSpeechProvider implements SpeechProvider {
  readonly name = "fake";

  async synthesize(request: SpeechSynthesisRequest): Promise<SynthesizedSpeech> {
    return {
      audio: Buffer.from(`Fake speech audio for: ${request.text}`),
      contentType: "audio/mpeg",
    };
  }

  async health(): Promise<SpeechProviderHealth> {
    return { status: "ready" };
  }
}
