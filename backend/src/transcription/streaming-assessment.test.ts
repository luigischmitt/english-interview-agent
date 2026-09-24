import { describe, expect, it, vi } from "vitest";
import { StreamingTranscriptionSessions } from "./streaming-transcription.js";
import type { PronunciationAssessmentService } from "./azure-pronunciation-assessment.js";
import type { TranscriptionService } from "./types.js";

describe("optional streaming assessment", () => {
  it("starts scripted assessment only after Whisper completes and is explicitly triggered", async () => {
    let finishAssessment!: (value: { provider: "azure"; locale: "en-US"; mode: "scripted"; scores: { accuracy: number; fluency: number; prosody: number } }) => void;
    let finishWhisper!: (value: { provider: "whisper-large-v3-turbo"; transcript: string }) => void;
    let receivedAudio: Buffer | undefined;
    let receivedFormat = "";
    let receivedReference = "";
    const assess = vi.fn((audio: Buffer, format: "webm" | "mp4", referenceText: string) => {
      receivedAudio = audio; receivedFormat = format; receivedReference = referenceText;
      return new Promise<any>((resolve) => { finishAssessment = resolve; });
    });
    const assessment = { assess } as PronunciationAssessmentService;
    const transcription = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe: (audio: Buffer) => new Promise<{ provider: "whisper-large-v3-turbo"; transcript: string }>((resolve) => { finishWhisper = resolve; }) } as unknown as TranscriptionService;
    const sessions = new StreamingTranscriptionSessions(transcription, Date.now, undefined, 16, assessment);
    const session = sessions.create("audio/webm", 0.025);
    session.vad.update(0.1, 0); session.vad.update(0.1, 200); session.vad.update(0.1, 800);
    sessions.append(session.id, 0, Buffer.from("same final audio"));
    const finalization = sessions.finalizeWithAssessment(session.id);
    await Promise.resolve();
    expect(assess).not.toHaveBeenCalled();
    finishWhisper({ provider: "whisper-large-v3-turbo", transcript: "Canonical Whisper transcript." });
    const finalized = await finalization;
    expect(finalized.result.transcript).toBe("Canonical Whisper transcript.");
    expect(assess).not.toHaveBeenCalled();

    const assessmentResult = finalized.startAssessment();
    expect(assess).toHaveBeenCalledOnce();
    expect(receivedAudio?.toString()).toBe("same final audio");
    expect(receivedFormat).toBe("webm");
    expect(receivedReference).toBe("Canonical Whisper transcript.");
    expect(finalized.startAssessment()).toBe(assessmentResult);
    finishAssessment({ provider: "azure", locale: "en-US", mode: "scripted", scores: { accuracy: 80, fluency: 75, prosody: 70 } });
    await expect(assessmentResult).resolves.toMatchObject({ mode: "scripted", scores: { accuracy: 80 } });
  });

  it("does not start assessment if canonical Whisper transcription fails", async () => {
    const assess = vi.fn();
    const assessment = { assess } as unknown as PronunciationAssessmentService;
    const transcription = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe: async () => { throw new Error("Whisper unavailable"); } } as unknown as TranscriptionService;
    const sessions = new StreamingTranscriptionSessions(transcription, Date.now, undefined, 16, assessment);
    const session = sessions.create("audio/mp4", 0.025);
    session.vad.update(0.1, 0); session.vad.update(0.1, 200); session.vad.update(0.1, 800);
    sessions.append(session.id, 0, Buffer.from("audio"));
    await expect(sessions.finalizeWithAssessment(session.id)).rejects.toThrow("Whisper unavailable");
    expect(assess).not.toHaveBeenCalled();
  });

  it("swallows assessment failure after starting it while preserving transcript", async () => {
    const assessment = { assess: async () => { throw new Error("Azure offline"); } } as PronunciationAssessmentService;
    const transcription = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe: async () => ({ provider: "whisper-large-v3-turbo" as const, transcript: "canonical" }) } as TranscriptionService;
    const sessions = new StreamingTranscriptionSessions(transcription, Date.now, undefined, 16, assessment);
    const session = sessions.create("audio/mp4", 0.025);
    session.vad.update(0.1, 0); session.vad.update(0.1, 200); session.vad.update(0.1, 800);
    sessions.append(session.id, 0, Buffer.from("x"));
    const finalized = await sessions.finalizeWithAssessment(session.id);
    expect(finalized.result.transcript).toBe("canonical");
    await expect(finalized.startAssessment()).resolves.toBeNull();
  });
});
