import assert from "node:assert/strict";
import test from "node:test";
import { buildAudioConstraints, classifyInputDevice, isDeviceUnavailableError, microphoneDeviceStorageKey, micTestStatus, readStoredMicrophoneDeviceId, storeMicrophoneDeviceId, toSelectableInputs } from "../src/lib/interview/mic-device.mjs";
import { parseRoomHandoff, serializeRoomHandoff } from "../src/lib/interview/room-handoff.mjs";
import { createMicEngine } from "../src/lib/interview/mic-engine.mjs";
import { createFakeMicDeps, runTimers } from "./mic-fakes.mjs";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
};
const config = {
  role: "Backend Engineer", seniority: "mid-level", focus: "technical-depth", duration: "15", questionCount: null,
  playInterviewerAudio: true, showQuestionCaptions: false, candidateCameraEnabled: false, autoCaptureVoice: true,
};

test("the chosen device persists, clears and survives broken storage", () => {
  const storage = memoryStorage();
  assert.equal(readStoredMicrophoneDeviceId(storage), null);
  assert.equal(storeMicrophoneDeviceId(storage, "abc123"), true);
  assert.equal(storage.map.get(microphoneDeviceStorageKey), "abc123");
  assert.equal(readStoredMicrophoneDeviceId(storage), "abc123");
  storeMicrophoneDeviceId(storage, null);
  assert.equal(readStoredMicrophoneDeviceId(storage), null);
  storage.map.set(microphoneDeviceStorageKey, "   ");
  assert.equal(readStoredMicrophoneDeviceId(storage), null);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readStoredMicrophoneDeviceId(broken), null);
  assert.equal(storeMicrophoneDeviceId(broken, "x"), false);
});

test("constraints use the exact device only when one is chosen", () => {
  assert.deepEqual(buildAudioConstraints(null), { channelCount: 1, echoCancellation: true, noiseSuppression: true });
  assert.deepEqual(buildAudioConstraints("dev-1"), { channelCount: 1, echoCancellation: true, noiseSuppression: true, deviceId: { exact: "dev-1" } });
  assert.equal(isDeviceUnavailableError({ name: "OverconstrainedError" }), true);
  assert.equal(isDeviceUnavailableError({ name: "NotFoundError" }), true);
  assert.equal(isDeviceUnavailableError({ name: "NotAllowedError" }), false);
});

test("the hand-off carries the device id and old configs without it still parse", () => {
  const withDevice = { ...config, microphoneDeviceId: "dev-1" };
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff(withDevice, 1), 2), withDevice);
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff(config, 1), 2), config);
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff({ ...config, microphoneDeviceId: null }, 1), 2), config);
  assert.deepEqual(parseRoomHandoff(serializeRoomHandoff({ ...config, microphoneDeviceId: 42 }, 1), 2), config);
});

test("device labels map to a coarse kind, never to the label", () => {
  const cases = [
    ["iPhone de Lucas Microphone", "continuity"],
    ["Default - MacBook Air Microphone", "builtin"],
    ["External Microphone", "external"],
    ["USB Audio Device", "external"],
    ["AirPods Pro", "bluetooth"],
    ["BlackHole 2ch", "virtual"],
    ["Zoom Audio Device", "virtual"],
    ["", "unknown"],
    ["Something else", "unknown"],
  ];
  for (const [label, kind] of cases) assert.equal(classifyInputDevice(label), kind, label);
  assert.equal(classifyInputDevice(undefined), "unknown");
});

test("selectable inputs drop aliases and name unlabeled devices", () => {
  const inputs = toSelectableInputs([
    { kind: "audioinput", deviceId: "default", label: "Default - Mic" },
    { kind: "audioinput", deviceId: "communications", label: "Communications" },
    { kind: "audioinput", deviceId: "a", label: "  MacBook Air Microphone " },
    { kind: "videoinput", deviceId: "v", label: "Camera" },
    { kind: "audioinput", deviceId: "b", label: "" },
  ]);
  assert.deepEqual(inputs, [{ deviceId: "a", label: "MacBook Air Microphone" }, { deviceId: "b", label: "Microfone 2" }]);
});

test("test status: hearing, waiting and silent after ~4 s without signal", () => {
  assert.equal(micTestStatus({ elapsedMs: 1_000, lastSignalAtMs: null }), "waiting");
  assert.equal(micTestStatus({ elapsedMs: 4_000, lastSignalAtMs: null }), "silent");
  assert.equal(micTestStatus({ elapsedMs: 5_000, lastSignalAtMs: 4_500 }), "hearing");
  assert.equal(micTestStatus({ elapsedMs: 9_000, lastSignalAtMs: 4_500 }), "waiting");
});

test("the engine opens the exact chosen device with the usual constraints", async () => {
  const deps = createFakeMicDeps();
  const engine = createMicEngine(deps, { deviceId: "dev-1" });
  await engine.acquire();
  assert.deepEqual(deps.log.constraints, [{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, deviceId: { exact: "dev-1" } } }]);
  assert.equal(engine.deviceId, "dev-1");
});

test("an unavailable chosen device falls back to the default once and says so", async () => {
  for (const name of ["OverconstrainedError", "NotFoundError"]) {
    const deps = createFakeMicDeps();
    deps.rejectWhen = (constraints) => (constraints.audio.deviceId ? Object.assign(new Error("gone"), { name }) : null);
    let fallbacks = 0;
    deps.onDeviceFallback = () => { fallbacks += 1; };
    const engine = createMicEngine(deps, { deviceId: "unplugged" });
    await engine.acquire();
    assert.equal(engine.state, "ready", name);
    assert.equal(fallbacks, 1);
    assert.equal(engine.deviceId, null);
    assert.equal(deps.log.constraints.length, 2);
    assert.equal(deps.log.constraints[1].audio.deviceId, undefined);
  }
});

test("other errors on the chosen device are not masked by a fallback", async () => {
  const deps = createFakeMicDeps();
  deps.rejectWhen = () => Object.assign(new Error("denied"), { name: "NotAllowedError" });
  let fallbacks = 0;
  deps.onDeviceFallback = () => { fallbacks += 1; };
  const engine = createMicEngine(deps, { deviceId: "dev-1" });
  await assert.rejects(engine.acquire());
  assert.equal(fallbacks, 0);
  assert.equal(deps.log.constraints.length, 1);
  assert.equal(engine.state, "failed");
});

test("setDeviceId applies to the next acquisition", async () => {
  const deps = createFakeMicDeps();
  const engine = createMicEngine(deps);
  await engine.acquire();
  engine.setDeviceId("dev-2");
  assert.equal(await engine.ensureHealthy({ force: true }), true);
  assert.deepEqual(deps.log.constraints[1].audio.deviceId, { exact: "dev-2" });
});

test("mic_open reports the device kind without the label; mic_level_check sends the peak once after ~3 s", async () => {
  const deps = createFakeMicDeps();
  deps.trackLabel = "iPhone de Lucas Microphone";
  const engine = createMicEngine(deps);
  await engine.acquire();
  const open = deps.log.diagnostics.find((event) => event.kind === "mic_open");
  assert.equal(open.inputDeviceKind, "continuity");
  assert.equal(JSON.stringify(deps.log.diagnostics).includes("Lucas"), false);

  engine.startCapture(() => {});
  deps.log.worklets[0].frame(0.2);
  deps.log.worklets[0].frame(0.05);
  engine.startCapture(() => {});
  assert.equal(deps.log.diagnostics.some((event) => event.kind === "mic_level_check"), false);
  runTimers(deps);
  const checks = deps.log.diagnostics.filter((event) => event.kind === "mic_level_check");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].inputDeviceKind, "continuity");
  assert.ok(Math.abs(checks[0].peakLevel - 0.2) < 1e-3);
  engine.release();
});
