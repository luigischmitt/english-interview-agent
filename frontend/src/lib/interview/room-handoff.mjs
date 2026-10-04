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
