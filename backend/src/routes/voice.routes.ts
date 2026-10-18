import express, { Router } from "express";
import type { Request, Response } from "express";

import type { PronunciationAssessmentService } from "../transcription/azure-pronunciation-assessment.js";

const minimumDurationMs = 300;
const maximumDurationMs = 20_000;
const audioBytesPerSecond = 16_000 * 2;
const validReferenceText = /^[\p{L}\p{N}\s.,!?'’";:()\-]+$/u;

type WavDetails = { durationMs: number };

function invalid(response: Response, code: "INVALID_PRACTICE_TEXT" | "INVALID_PRACTICE_AUDIO") {
  return response.status(400).json({ error: { code } });
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 300 && validReferenceText.test(value);
}

/** Parse only the WAV fields Azure's scripted endpoint accepts; audio itself is never persisted. */
export function parsePracticeWav(audio: unknown): WavDetails | null {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.subarray(0, 4).toString("ascii") !== "RIFF" || audio.subarray(8, 12).toString("ascii") !== "WAVE") return null;
  let offset = 12;
  let hasPcmFormat = false;
  let dataBytes: number | null = null;
  while (offset + 8 <= audio.length) {
    const id = audio.subarray(offset, offset + 4).toString("ascii");
    const size = audio.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > audio.length) return null;
    if (id === "fmt ") {
      if (size < 16) return null;
      hasPcmFormat = audio.readUInt16LE(dataOffset) === 1
        && audio.readUInt16LE(dataOffset + 2) === 1
        && audio.readUInt32LE(dataOffset + 4) === 16_000
        && audio.readUInt16LE(dataOffset + 14) === 16
        && audio.readUInt16LE(dataOffset + 12) === 2;
    } else if (id === "data" && dataBytes === null) {
      dataBytes = size;
    }
    offset = dataOffset + size + (size % 2);
  }
  if (!hasPcmFormat || dataBytes === null || dataBytes <= 0) return null;
  const durationMs = (dataBytes / audioBytesPerSecond) * 1_000;
  return durationMs > minimumDurationMs && durationMs <= maximumDurationMs ? { durationMs: Math.round(durationMs) } : null;
}

/** Per-process limit. Cloud Run is intentionally configured with one instance; counts reset on a restart. */
export class PracticeDailyLimit {
  private readonly attempts = new Map<string, number>();

  constructor(private readonly maximumAttempts = practiceDailyLimitFromEnvironment()) {}

  tryTake(userId: string, now = new Date()): boolean {
    const key = `${userId}:${now.toISOString().slice(0, 10)}`;
    const attempts = this.attempts.get(key) ?? 0;
    if (attempts >= this.maximumAttempts) return false;
    this.attempts.set(key, attempts + 1);
    return true;
  }
}

export function practiceDailyLimitFromEnvironment(environment = process.env): number {
  const value = environment.PRACTICE_DAILY_LIMIT;
  if (value === undefined || value.trim() === "") return 40;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("PRACTICE_DAILY_LIMIT must be a positive integer.");
  return parsed;
}

export function createVoiceRouter(service: PronunciationAssessmentService | null, limit = new PracticeDailyLimit(), logger: (line: string) => void = console.info) {
  const voiceRouter = Router();
  voiceRouter.post("/practice", express.raw({ type: "audio/wav", limit: "1mb" }), async (request: Request, response: Response) => {
    const referenceText = typeof request.query.text === "string" ? request.query.text.trim() : "";
    if (!validText(referenceText)) return invalid(response, "INVALID_PRACTICE_TEXT");
    const wav = parsePracticeWav(request.body);
    if (!wav) return invalid(response, "INVALID_PRACTICE_AUDIO");
    if (!service) return response.status(503).json({ error: { code: "PRACTICE_UNAVAILABLE" } });

    const userId = response.locals.authenticatedUser?.userId;
    if (typeof userId !== "string" || !limit.tryTake(userId)) return response.status(429).json({ error: { code: "PRACTICE_DAILY_LIMIT" } });

    const controller = new AbortController();
    const abortWhenDisconnected = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once("aborted", abortWhenDisconnected);
    response.once("close", abortWhenDisconnected);
    try {
      const assessment = await service.assess(request.body, "wav", referenceText, controller.signal);
      logger(JSON.stringify({ event: "practice_assessment", status: "available", assessedDurationMs: wav.durationMs }));
      return response.status(200).json({
        scores: assessment.scores,
        words: (assessment.words ?? []).map(({ word, accuracyScore, errorType }) => ({ word, accuracyScore, errorType })),
      });
    } catch {
      logger(JSON.stringify({ event: "practice_assessment", status: "unavailable", assessedDurationMs: 0 }));
      if (!response.headersSent && !controller.signal.aborted) return response.status(503).json({ error: { code: "PRACTICE_UNAVAILABLE" } });
    } finally {
      request.removeListener("aborted", abortWhenDisconnected);
      response.removeListener("close", abortWhenDisconnected);
      if (Buffer.isBuffer(request.body)) request.body.fill(0);
    }
  });
  // `express.raw` rejects payloads above its safety limit before the handler runs.
  voiceRouter.use((error: unknown, _request: Request, response: Response, next: (error: unknown) => void) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") return invalid(response, "INVALID_PRACTICE_AUDIO");
    next(error);
  });
  return voiceRouter;
}
