import { describe, expect, it } from "vitest";

import { buildSpeechUrl, buildStreamUrl, fetchSpeechAudio, framePcm, mergeTranscriptWindow, parseArgs, rmsLevel } from "../src/transcription/audio-stream-e2e.js";

describe("real-time audio E2E harness utilities", () => {
  it("parses CLI configuration and rejects URLs that could expose credentials", () => {
    const options = parseArgs(["--backend-url", "http://localhost:3001", "--speed=1.2", "--text=A short=answer."], {});
    expect(options.backendUrl.href).toBe("http://localhost:3001/");
    expect(options.speed).toBe(1.2);
    expect(options.text).toBe("A short=answer.");
    expect(() => parseArgs(["--backend-url", "https://user:secret@example.test"], {})).toThrow(/without credentials/);
    expect(() => parseArgs(["--backend-url", "https://example.test/?token=secret"], {})).toThrow(/without credentials/);
  });

  it("builds speech and stream endpoints at the origin root or beneath a base path", () => {
    const root = new URL("http://localhost:3001/");
    expect(buildSpeechUrl(root).href).toBe("http://localhost:3001/api/v1/speech");
    expect(buildStreamUrl(root).href).toBe("ws://localhost:3001/api/v1/transcriptions/stream");

    const prefixed = new URL("https://example.test/interview-api/");
    expect(buildSpeechUrl(prefixed).href).toBe("https://example.test/interview-api/api/v1/speech");
    expect(buildStreamUrl(prefixed).href).toBe("wss://example.test/interview-api/api/v1/transcriptions/stream");
  });

  it("uses a default spoken answer long enough to exercise overlapping windows", () => {
    const defaultAnswer = parseArgs([], {}).text;
    expect(defaultAnswer.split(/\s+/u).length).toBeGreaterThanOrEqual(70);
  });

  it("splits PCM into 100 ms frames and pads trailing silence", () => {
    const pcm = Buffer.alloc(2 * 1_600);
    pcm.writeInt16LE(16_384, 0);
    const frames = framePcm(pcm, 0);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(3_200);
    expect(rmsLevel(frames[0])).toBeCloseTo(0.0125, 4);

    const padded = framePcm(pcm, 1);
    expect(padded).toHaveLength(2);
    expect(padded[1].every((byte) => byte === 0)).toBe(true);
  });

  it("merges repeated words at the overlap between adjacent Whisper windows", () => {
    expect(mergeTranscriptWindow("I improved the reporting service", "the reporting service and reduced latency"))
      .toBe("I improved the reporting service and reduced latency");
    expect(mergeTranscriptWindow("first answer", "new words here"))
      .toBe("first answer new words here");
  });

  it("keeps the speech timeout active while a response body is stalled", async () => {
    let signalAborted = false;
    const fetcher: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => {
            signalAborted = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, { headers: { "content-type": "audio/mpeg" } });
    };

    const startedAt = Date.now();
    await expect(fetchSpeechAudio(new URL("http://localhost:3001/api/v1/speech"), { text: "test", speed: 1 }, 25, fetcher))
      .rejects.toThrow(/timed out/);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(signalAborted).toBe(true);
  });

  it("rejects malformed PCM and unsafe parameter values", () => {
    expect(() => framePcm(Buffer.from([0]))).toThrow(/complete 16-bit samples/);
    expect(() => rmsLevel(Buffer.alloc(0))).toThrow(/complete 16-bit samples/);
    expect(() => parseArgs(["--timeout-ms", "-1"], {})).toThrow(/integer between/);
    expect(() => parseArgs(["--unexpected", "value"], {})).toThrow(/Unknown option/);
  });
});
