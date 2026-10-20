import { isValidJobDirection } from "./job-direction.mjs";

export const LOCAL_CHECKPOINT_VERSION = 1;
export const LOCAL_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const prefix = "entoa:interview-checkpoint:v1:";

export function createLocalSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function localCheckpointKey(userId) {
  return `${prefix}${encodeURIComponent(userId)}`;
}

function safeConfig(config) {
  if (!config || typeof config !== "object" || typeof config.role !== "string" || !config.role.trim()) return null;
  const strings = ["seniority", "focus", "duration"];
  const booleans = ["playInterviewerAudio", "showInterviewerCharacter", "showQuestionCaptions", "candidateCameraEnabled", "autoCaptureVoice"];
  if (strings.some((key) => typeof config[key] !== "string") || booleans.some((key) => typeof config[key] !== "boolean")) return null;
  const direction = isValidJobDirection(config.jobDirection)
    && config.jobDirection.targetRole === config.role
    && config.jobDirection.suggestedSeniority === config.seniority
    ? config.jobDirection
    : undefined;
  return {
    role: config.role.trim(), seniority: config.seniority, focus: config.focus, duration: config.duration,
    questionCount: config.questionCount === null || typeof config.questionCount === "string" ? config.questionCount : null,
    playInterviewerAudio: config.playInterviewerAudio,
    showInterviewerCharacter: config.showInterviewerCharacter,
    showQuestionCaptions: config.showQuestionCaptions,
    candidateCameraEnabled: config.candidateCameraEnabled,
    autoCaptureVoice: config.autoCaptureVoice,
    ...(direction ? { jobDirection: direction } : {}),
    ...(["job", "resume"].includes(config.interviewSource) ? { interviewSource: config.interviewSource } : {}),
    ...(typeof config.voice === "string" ? { voice: config.voice } : {}),
    ...(typeof config.speechSpeed === "number" ? { speechSpeed: config.speechSpeed } : {}),
  };
}

function validSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const { activeQuestion, currentIndex, questionSequenceNumber, followUpUsed, elapsedSeconds, turns, askedQuestionIds } = snapshot;
  return activeQuestion && typeof activeQuestion.id === "string" && typeof activeQuestion.prompt === "string"
    && typeof activeQuestion.cue === "string" && Number.isSafeInteger(currentIndex) && currentIndex >= 0
    && Number.isSafeInteger(questionSequenceNumber) && questionSequenceNumber > 0
    && typeof followUpUsed === "boolean" && Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
    && Array.isArray(turns) && turns.length <= 100
    && turns.every((turn) => Number.isSafeInteger(turn.sequenceNumber) && turn.sequenceNumber > 0
      && (turn.speaker === "interviewer" || turn.speaker === "candidate")
      && (turn.content === null || (typeof turn.content === "string" && turn.content.length <= 10_000)))
    && Array.isArray(askedQuestionIds) && askedQuestionIds.length <= 100 && askedQuestionIds.every((id) => typeof id === "string");
}

function parseRecord(raw, userId, now) {
  let record;
  try { record = JSON.parse(raw); } catch { return null; }
  if (!record || record.version !== LOCAL_CHECKPOINT_VERSION || record.userId !== userId
    || typeof record.updatedAt !== "number" || now - record.updatedAt > LOCAL_CHECKPOINT_TTL_MS
    || record.updatedAt > now + 60_000 || typeof record.localSessionId !== "string"
    || !safeConfig(record.config) || !validSnapshot(record.snapshot)
    || !Array.isArray(record.syncedSequences) || typeof record.remoteSessionId !== "string" && record.remoteSessionId !== null
    || !["in_progress", "completed", "abandoned"].includes(record.status)) return null;
  return record;
}

export function readLocalCheckpoint(storage, userId, now = Date.now()) {
  if (!storage || typeof userId !== "string" || !userId) return null;
  const key = localCheckpointKey(userId);
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  const record = parseRecord(raw, userId, now);
  if (record) return record;
  try { storage.removeItem(key); } catch { /* Expired or invalid data is never restored. */ }
  return null;
}

export function readResumableCheckpoint(storage, userId, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  return record?.status === "in_progress" ? record : null;
}

export function readLocalCheckpointForSession(storage, userId, localSessionId, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  return record?.localSessionId === localSessionId ? record : null;
}

export function writeLocalCheckpoint(storage, input, now = Date.now()) {
  if (!storage || typeof input?.userId !== "string" || !input.userId || !safeConfig(input.config) || !validSnapshot(input.snapshot)) return false;
  const existing = readLocalCheckpoint(storage, input.userId, now);
  if (existing && input.localSessionId && existing.localSessionId !== input.localSessionId) {
    if (!canClearCheckpointAfterSync(existing)) return false;
    clearLocalCheckpoint(storage, input.userId);
  }
  const sameSession = existing && (!input.localSessionId || existing.localSessionId === input.localSessionId) ? existing : null;
  const record = {
    version: LOCAL_CHECKPOINT_VERSION,
    userId: input.userId,
    localSessionId: input.localSessionId ?? sameSession?.localSessionId ?? createLocalSessionId(),
    createdAt: sameSession?.createdAt ?? now,
    updatedAt: now,
    config: safeConfig(input.config),
    snapshot: input.snapshot,
    remoteSessionId: input.remoteSessionId ?? sameSession?.remoteSessionId ?? null,
    syncedSequences: input.syncedSequences ?? sameSession?.syncedSequences ?? [],
    status: input.status ?? sameSession?.status ?? "in_progress",
  };
  const key = localCheckpointKey(input.userId);
  try {
    const serialized = JSON.stringify(record);
    if (serialized.length > 250_000) return false;
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch { return false; }
}

export function upsertLocalCheckpointTurn(storage, userId, turn, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  if (!record || !turn || !Number.isSafeInteger(turn.sequenceNumber) || turn.sequenceNumber < 1
    || !["interviewer", "candidate"].includes(turn.speaker)
    || turn.content !== null && typeof turn.content !== "string") return false;
  const existing = record.snapshot.turns.find((item) => item.sequenceNumber === turn.sequenceNumber);
  const turns = [...record.snapshot.turns.filter((item) => item.sequenceNumber !== turn.sequenceNumber), turn]
    .sort((first, second) => first.sequenceNumber - second.sequenceNumber);
  const syncedSequences = existing && existing.content !== turn.content
    ? record.syncedSequences.filter((sequence) => sequence !== turn.sequenceNumber)
    : record.syncedSequences;
  return writeLocalCheckpoint(storage, { ...record, snapshot: { ...record.snapshot, turns }, syncedSequences }, now);
}

function patchRecord(storage, userId, patch, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  if (!record) return false;
  return writeLocalCheckpoint(storage, { ...record, ...patch, userId }, now);
}

export function setCheckpointRemoteSessionId(storage, userId, remoteSessionId, now = Date.now()) {
  return typeof remoteSessionId === "string" && remoteSessionId
    ? patchRecord(storage, userId, { remoteSessionId }, now) : false;
}

export function markCheckpointTurnSynced(storage, userId, sequenceNumber, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  if (!record || !Number.isSafeInteger(sequenceNumber)) return false;
  return patchRecord(storage, userId, { syncedSequences: [...new Set([...record.syncedSequences, sequenceNumber])] }, now);
}

export function markCheckpointTurnPending(storage, userId, sequenceNumber, now = Date.now()) {
  const record = readLocalCheckpoint(storage, userId, now);
  if (!record || !Number.isSafeInteger(sequenceNumber)) return false;
  return patchRecord(storage, userId, { syncedSequences: record.syncedSequences.filter((value) => value !== sequenceNumber) }, now);
}

export function setCheckpointStatus(storage, userId, status, now = Date.now()) {
  if (!["in_progress", "completed", "abandoned"].includes(status)) return false;
  return patchRecord(storage, userId, { status }, now);
}

export function canClearCheckpointAfterSync(record) {
  if (!record || record.status === "in_progress") return false;
  return record.snapshot.turns.every((turn) => record.syncedSequences.includes(turn.sequenceNumber));
}

export function clearLocalCheckpoint(storage, userId) {
  if (!storage || typeof userId !== "string" || !userId) return false;
  try { storage.removeItem(localCheckpointKey(userId)); return true; } catch { return false; }
}
