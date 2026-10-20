import assert from "node:assert/strict";
import test from "node:test";

import {
  canClearCheckpointAfterSync,
  clearLocalCheckpoint,
  localCheckpointKey,
  markCheckpointTurnSynced,
  readLocalCheckpoint,
  readResumableCheckpoint,
  setCheckpointStatus,
  upsertLocalCheckpointTurn,
  writeLocalCheckpoint,
} from "../src/lib/interview/local-checkpoint.mjs";

class MemoryStorage {
  values = new Map();
  failWrites = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrites) throw new Error("QuotaExceededError"); this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

const config = {
  role: "Backend Engineer", seniority: "senior", focus: "mixed", duration: "20", questionCount: "8",
  playInterviewerAudio: true, showInterviewerCharacter: true, showQuestionCaptions: true,
  candidateCameraEnabled: false, autoCaptureVoice: false, microphoneDeviceId: "private-device-id",
};
const snapshot = {
  activeQuestion: { id: "tradeoffs", prompt: "Tell me about a technical trade-off?", cue: "Give an example." },
  currentIndex: 2, questionSequenceNumber: 5, followUpUsed: true, elapsedSeconds: 184,
  turns: [
    { sequenceNumber: 1, speaker: "interviewer", content: "Tell me about your work?" },
    { sequenceNumber: 2, speaker: "candidate", content: "I led a migration." },
  ],
  askedQuestionIds: ["opening", "project", "tradeoffs"],
};

test("an interview saved locally after a remote failure restores its active question and submitted turns after reload", () => {
  const storage = new MemoryStorage();
  assert.equal(writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000), true);

  // A new route/runtime reading the same browser storage models the page reload.
  const restored = readResumableCheckpoint(storage, "user-a", 2_000);
  assert.equal(restored.status, "in_progress");
  assert.equal(restored.remoteSessionId, null, "the failed remote create remains queued locally");
  assert.equal(restored.snapshot.activeQuestion.id, "tradeoffs");
  assert.equal(restored.snapshot.questionSequenceNumber, 5);
  assert.equal(restored.snapshot.turns[1].content, "I led a migration.");
  assert.equal("microphoneDeviceId" in restored.config, false);
});

test("a resume interview keeps its source after reload without persisting resume contents", () => {
  const storage = new MemoryStorage();
  const resumeConfig = {
    ...config,
    role: "Prática pelo currículo",
    interviewSource: "resume",
    resumeText: "private resume contents",
  };
  assert.equal(writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config: resumeConfig, snapshot }, 1_000), true);

  const restored = readResumableCheckpoint(storage, "user-a", 2_000);
  assert.equal(restored.config.interviewSource, "resume");
  assert.equal("resumeText" in restored.config, false);
});

test("checkpoints are isolated by user and expired records are deleted", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  assert.equal(readLocalCheckpoint(storage, "user-b", 2_000), null);
  assert.equal(readLocalCheckpoint(storage, "user-a", 1_000 + 7 * 24 * 60 * 60 * 1000 + 1), null);
  assert.equal(storage.getItem(localCheckpointKey("user-a")), null);
});

test("unknown schema versions and invalid snapshots are removed instead of restored", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  const key = localCheckpointKey("user-a");
  const valid = JSON.parse(storage.getItem(key));
  storage.setItem(key, JSON.stringify({ ...valid, version: 2 }));
  assert.equal(readResumableCheckpoint(storage, "user-a", 1_100), null);
  assert.equal(storage.getItem(key), null);

  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_200);
  const malformed = JSON.parse(storage.getItem(key));
  malformed.snapshot.activeQuestion.prompt = 123;
  storage.setItem(key, JSON.stringify(malformed));
  assert.equal(readResumableCheckpoint(storage, "user-a", 1_300), null);
  assert.equal(storage.getItem(key), null);
});

test("turn upserts deduplicate by sequence, changed content becomes pending, and completed sync can be cleaned", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  assert.equal(upsertLocalCheckpointTurn(storage, "user-a", snapshot.turns[1], 1_100), true);
  let record = readLocalCheckpoint(storage, "user-a", 1_100);
  assert.equal(record.snapshot.turns.filter((turn) => turn.sequenceNumber === 2).length, 1);
  markCheckpointTurnSynced(storage, "user-a", 1, 1_200);
  markCheckpointTurnSynced(storage, "user-a", 2, 1_200);
  assert.equal(setCheckpointStatus(storage, "user-a", "completed", 1_300), true);
  record = readLocalCheckpoint(storage, "user-a", 1_300);
  assert.equal(canClearCheckpointAfterSync(record), true);
  assert.equal(clearLocalCheckpoint(storage, "user-a"), true);
  assert.equal(readLocalCheckpoint(storage, "user-a", 1_300), null);
});

test("a corrected turn is deduplicated and loses its synced marker until resent", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  markCheckpointTurnSynced(storage, "user-a", 2, 1_100);
  assert.equal(upsertLocalCheckpointTurn(storage, "user-a", { ...snapshot.turns[1], content: "I led a careful migration." }, 1_200), true);
  const record = readLocalCheckpoint(storage, "user-a", 1_200);
  assert.equal(record.snapshot.turns.filter((turn) => turn.sequenceNumber === 2).length, 1);
  assert.equal(record.syncedSequences.includes(2), false);
});

test("a new local session never inherits the prior session id or sync markers", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  markCheckpointTurnSynced(storage, "user-a", 1, 1_100);
  markCheckpointTurnSynced(storage, "user-a", 2, 1_100);
  setCheckpointStatus(storage, "user-a", "completed", 1_100);
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-b", config, snapshot }, 1_200);
  const record = readLocalCheckpoint(storage, "user-a", 1_200);
  assert.equal(record.localSessionId, "local-b");
  assert.equal(record.syncedSequences.length, 0);
  assert.equal(record.remoteSessionId, null);
  assert.equal(record.createdAt, 1_200);
});

test("a different unsynced session is preserved instead of being overwritten", () => {
  const storage = new MemoryStorage();
  writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000);
  assert.equal(writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-b", config, snapshot }, 1_100), false);
  const record = readLocalCheckpoint(storage, "user-a", 1_100);
  assert.equal(record.localSessionId, "local-a");
  assert.equal(record.snapshot.turns[1].content, "I led a migration.");
});

test("storage quota/write failures return false so the UI cannot claim a local save", () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  assert.equal(writeLocalCheckpoint(storage, { userId: "user-a", localSessionId: "local-a", config, snapshot }, 1_000), false);
  assert.equal(readLocalCheckpoint(storage, "user-a", 1_000), null);
});
