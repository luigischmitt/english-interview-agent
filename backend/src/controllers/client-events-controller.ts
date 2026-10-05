import type { RequestHandler } from "express";

/** Content-free client audio diagnostics. Only the whitelisted fields below ever reach the logs. */
export const maxClientEventsPerRequest = 20;
/** Global safety valve against log flooding (events per minute, per process). */
export const maxClientEventsPerMinute = 1_200;

const kinds = ["playback_start", "playback_playing", "playback_play_resolved", "playback_ended", "playback_error", "playback_timeout", "unlock", "mic_open", "mic_close", "mic_error", "mic_level_check", "audio_session", "ack_preloaded", "ack_play", "ack_play_resolved", "ack_play_failed", "ack_ended", "ack_skipped", "ack_overlap", "ack_question_gap"] as const;
/** Why an instant acknowledgement was not spoken. */
const ackSkipReasons = ["not_loaded", "not_applicable", "question_started"] as const;
const errorNames = ["NotAllowedError", "NotSupportedError", "AbortError", "NotFoundError", "InvalidStateError", "EncodingError", "NotReadableError", "SecurityError", "OverconstrainedError", "TypeError", "Error", "MediaError", "other"] as const;
const audioContextStates = ["suspended", "running", "closed", "interrupted", "none"] as const;
const audioSessionTypes = ["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"] as const;
const platforms = ["ios", "android", "desktop"] as const;
const inAppBrowsers = ["google", "instagram", "facebook", "linkedin", "tiktok", "line", "twitter", "none"] as const;
const outputs = ["element", "webaudio"] as const;
/** Coarse device class derived on the client from the label; the label itself (may hold a personal name) is never sent. */
const inputDeviceKinds = ["builtin", "external", "continuity", "bluetooth", "virtual", "unknown"] as const;

const enumFields: Record<string, readonly string[]> = {
  kind: kinds,
  errorName: errorNames,
  audioContextState: audioContextStates,
  micContextState: audioContextStates,
  audioSessionType: audioSessionTypes,
  platform: platforms,
  output: outputs,
  inAppBrowser: inAppBrowsers,
  inputDeviceKind: inputDeviceKinds,
  reason: ackSkipReasons,
};
// Numeric fields with their inclusive [min, max] range.
const numberFields: Record<string, readonly [number, number]> = {
  chunkIndex: [0, 1_000],
  chunkCount: [0, 1_000],
  elapsedMs: [0, 3_600_000],
  mediaVolume: [0, 1],
  mediaCurrentTimeMs: [0, 3_600_000],
  mediaDurationMs: [0, 3_600_000],
  readyState: [0, 4],
  peakLevel: [0, 1],
  loaded: [0, 100],
  total: [0, 100],
  answerToAckMs: [0, 3_600_000],
  ackDurationMs: [0, 3_600_000],
  ackToQuestionMs: [0, 3_600_000],
};
const booleanFields = ["mediaMuted", "mediaPaused", "micActive", "pooled", "audioSessionPresent"] as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns the sanitized event, or null when it has no valid `kind`. Unknown or invalid fields are dropped. */
export function sanitizeClientEvent(raw: unknown): UnknownRecord | null {
  if (!isRecord(raw)) return null;
  const event: UnknownRecord = {};
  for (const [field, allowed] of Object.entries(enumFields)) {
    const value = raw[field];
    if (typeof value === "string" && allowed.includes(value)) event[field] = value;
  }
  if (typeof event.kind !== "string") return null;
  for (const [field, [min, max]] of Object.entries(numberFields)) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) event[field] = Math.round(value * 1_000) / 1_000;
  }
  for (const field of booleanFields) {
    if (typeof raw[field] === "boolean") event[field] = raw[field];
  }
  return event;
}

export function createClientEventsController(log: (line: string) => void = (line) => console.info(line), now: () => number = Date.now): RequestHandler {
  let windowStart = 0;
  let windowCount = 0;
  return (request, response) => {
    const body: unknown = request.body;
    const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.events) ? body.events : null;
    if (!list || list.length === 0 || list.length > maxClientEventsPerRequest) {
      response.status(400).json({ error: { code: "INVALID_CLIENT_EVENTS", message: `Send between 1 and ${maxClientEventsPerRequest} events.` } });
      return;
    }
    const timestamp = now();
    if (timestamp - windowStart >= 60_000) { windowStart = timestamp; windowCount = 0; }
    let accepted = 0;
    for (const raw of list) {
      const event = sanitizeClientEvent(raw);
      if (!event || windowCount >= maxClientEventsPerMinute) continue;
      windowCount += 1;
      accepted += 1;
      log(JSON.stringify({ event: "client_audio_diagnostic", ...event }));
    }
    response.status(202).json({ accepted });
  };
}
