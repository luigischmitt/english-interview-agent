import { normalizeDeviceId } from "./mic-device.mjs";
import { isValidJobDirection } from "./job-direction.mjs";
import { INTERVIEWER_VOICES } from "./voices.mjs";

/**
 * Hand-off of the interview configuration from the setup (inside the app shell) to the dedicated interview route.
 * Stored in sessionStorage (tab-scoped, never sent anywhere) and consumed once: a reload or a direct visit finds
 * nothing and goes back to the setup instead of silently restarting an interview.
 */
export const roomHandoffKey = "eia:interview-room-handoff";
export const roomHandoffMaxAgeMs = 10 * 60 * 1000;

const stringFields = ["role", "seniority", "focus", "duration"];
const booleanFields = ["playInterviewerAudio", "showQuestionCaptions", "candidateCameraEnabled", "autoCaptureVoice"];

export function serializeRoomHandoff(config, now = Date.now()) {
  return JSON.stringify({ version: 1, createdAt: now, config });
}

/** Returns a validated config, or null when missing, malformed, stale or incomplete. */
export function parseRoomHandoff(raw, now = Date.now()) {
  if (typeof raw !== "string" || raw === "") return null;
  let payload;
  try { payload = JSON.parse(raw); } catch { return null; }
  if (!payload || typeof payload !== "object" || payload.version !== 1) return null;
  if (typeof payload.createdAt !== "number" || now - payload.createdAt > roomHandoffMaxAgeMs || payload.createdAt > now + 60_000) return null;
  const config = payload.config;
  if (!config || typeof config !== "object") return null;
  for (const field of stringFields) if (typeof config[field] !== "string") return null;
  if (config.role.trim() === "") return null;
  for (const field of booleanFields) if (typeof config[field] !== "boolean") return null;
  if (config.questionCount !== null && typeof config.questionCount !== "string") return null;
  const microphoneDeviceId = normalizeDeviceId(config.microphoneDeviceId);
  const jobDirection = isValidJobDirection(config.jobDirection)
    && config.jobDirection.targetRole === config.role
    && config.jobDirection.suggestedSeniority === config.seniority
    ? config.jobDirection
    : undefined;
  const interviewSource = config.interviewSource === "resume" && jobDirection?.tailoredQuestions?.length
    ? "resume"
    : config.interviewSource === "job" && jobDirection
      ? "job"
      : "manual";
  return {
    role: config.role,
    seniority: config.seniority,
    focus: config.focus,
    duration: config.duration,
    questionCount: config.questionCount,
    playInterviewerAudio: config.playInterviewerAudio,
    showQuestionCaptions: config.showQuestionCaptions,
    candidateCameraEnabled: config.candidateCameraEnabled,
    autoCaptureVoice: config.autoCaptureVoice,
    // Optional (older hand-offs have none): the input device chosen on the setup.
    ...(microphoneDeviceId === null ? {} : { microphoneDeviceId }),
    ...(jobDirection ? { jobDirection } : {}),
    ...(interviewSource !== "manual" ? { interviewSource } : {}),
    // Optional (older hand-offs have none): only a known interviewer voice is kept; otherwise the room uses the default.
    ...(INTERVIEWER_VOICES.includes(config.voice) ? { voice: config.voice } : {}),
  };
}

/** Writes the hand-off; false when storage is unavailable (the caller must not navigate). */
export function storeRoomHandoff(storage, config, now = Date.now()) {
  try { storage.setItem(roomHandoffKey, serializeRoomHandoff(config, now)); return true; } catch { return false; }
}

/** Reads and removes the hand-off in one step (single use). */
export function consumeRoomHandoff(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(roomHandoffKey);
    storage.removeItem(roomHandoffKey);
    return parseRoomHandoff(raw, now);
  } catch { return null; }
}
