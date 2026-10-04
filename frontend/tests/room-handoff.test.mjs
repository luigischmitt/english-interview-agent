import assert from "node:assert/strict";
import test from "node:test";
import { consumeRoomHandoff, parseRoomHandoff, roomHandoffKey, roomHandoffMaxAgeMs, serializeRoomHandoff, storeRoomHandoff } from "../src/lib/interview/room-handoff.mjs";
import { levelToIntensity, smoothIntensity } from "../src/lib/interview/mic-level-visual.mjs";

const config = {
  role: "Backend Engineer", seniority: "mid-level", focus: "technical-depth", duration: "15", questionCount: null,
  playInterviewerAudio: true, showQuestionCaptions: false, candidateCameraEnabled: false, autoCaptureVoice: true,
};
const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
};

test("round-trips a valid config", () => {
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff(config, 1000), 2000), config);
});

test("rejects missing, malformed, stale, future and incomplete payloads", () => {
  assert.equal(parseRoomHandoff(null), null);
  assert.equal(parseRoomHandoff("not json"), null);
  assert.equal(parseRoomHandoff(JSON.stringify({ version: 2, createdAt: 1, config })), null);
  assert.equal(parseRoomHandoff(serializeRoomHandoff(config, 0), roomHandoffMaxAgeMs + 1), null);
  assert.equal(parseRoomHandoff(serializeRoomHandoff(config, 10 * 60_000), 0), null);
  assert.equal(parseRoomHandoff(serializeRoomHandoff({ ...config, role: "  " }, 1), 2), null);
  assert.equal(parseRoomHandoff(serializeRoomHandoff({ ...config, autoCaptureVoice: "yes" }, 1), 2), null);
  assert.equal(parseRoomHandoff(serializeRoomHandoff({ ...config, questionCount: 3 }, 1), 2), null);
});

test("drops unknown fields, including retired ones from older configs", () => {
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff({ ...config, showCandidateCaptions: false, transcriptionEngine: "ink-2" }, 1), 2), config);
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff({ ...config, extra: "x" }, 1), 2), config);
});

test("the stored hand-off is consumed exactly once", () => {
  const storage = memoryStorage();
  assert.equal(storeRoomHandoff(storage, config, 1), true);
  assert.equal(storage.map.has(roomHandoffKey), true);
  assert.deepEqual(consumeRoomHandoff(storage, 2), config);
  assert.equal(storage.map.has(roomHandoffKey), false);
  assert.equal(consumeRoomHandoff(storage, 3), null);
});

test("storage failures are reported, not thrown", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(storeRoomHandoff(broken, config), false);
  assert.equal(consumeRoomHandoff(broken), null);
});

test("level maps to a clamped 0..1 intensity", () => {
  assert.equal(levelToIntensity(0), 0);
  assert.equal(levelToIntensity(NaN), 0);
  assert.equal(levelToIntensity(0.0005), 0);
  assert.equal(levelToIntensity(1), 1);
  const quiet = levelToIntensity(0.005);
  const normal = levelToIntensity(0.03);
  assert.ok(quiet > 0 && quiet < normal && normal < 1);
});

test("smoothing rises faster than it falls and settles at zero", () => {
  const up = smoothIntensity(0, 1);
  const down = 1 - smoothIntensity(1, 0);
  assert.ok(up > down);
  let value = 1;
  for (let i = 0; i < 80; i += 1) value = smoothIntensity(value, 0);
  assert.equal(value, 0);
});
