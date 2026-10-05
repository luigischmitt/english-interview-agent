/**
 * Microphone device choice: persisted per browser (localStorage, never sent anywhere), turned into getUserMedia
 * constraints, and classified into a coarse, content-free kind for diagnostics. Device labels can contain personal
 * names ("iPhone de Lucas"), so a label is only ever mapped to a kind and is never logged or sent.
 */
export const microphoneDeviceStorageKey = "eia:microphone-device-id";
const maxDeviceIdLength = 512;

/** The base audio constraints of every interview capture. */
export const baseAudioConstraints = Object.freeze({ channelCount: 1, echoCancellation: true, noiseSuppression: true });

export const inputDeviceKinds = ["builtin", "external", "continuity", "bluetooth", "virtual", "unknown"];

/** A usable stored/handed-off device id, or null. */
export function normalizeDeviceId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id === "" || id.length > maxDeviceIdLength ? null : id;
}

export function readStoredMicrophoneDeviceId(storage) {
  try { return normalizeDeviceId(storage.getItem(microphoneDeviceStorageKey)); } catch { return null; }
}

/** Persists the choice (null clears it). False when storage is unavailable. */
export function storeMicrophoneDeviceId(storage, deviceId) {
  try {
    const id = normalizeDeviceId(deviceId);
    if (id === null) storage.removeItem(microphoneDeviceStorageKey); else storage.setItem(microphoneDeviceStorageKey, id);
    return true;
  } catch { return false; }
}

/** `audio` constraints: the exact device when one is chosen, otherwise the browser's default input. */
export function buildAudioConstraints(deviceId = null) {
  const id = normalizeDeviceId(deviceId);
  return id === null ? { ...baseAudioConstraints } : { ...baseAudioConstraints, deviceId: { exact: id } };
}

/** The chosen device is gone or cannot satisfy the constraints: the caller may retry on the default input. */
export function isDeviceUnavailableError(error) {
  const name = error?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/** Maps a device label to a coarse kind by keywords. Only the kind may leave the browser. */
export function classifyInputDevice(label) {
  if (typeof label !== "string" || label.trim() === "") return "unknown";
  const text = label.toLowerCase();
  if (/\b(iphone|ipad)\b|continuity/.test(text)) return "continuity";
  if (/blackhole|loopback|soundflower|virtual|aggregate|multi-output|vb-audio|voicemod|krisp|obs\b|\bcable\b|zoom|teams|ndi\b/.test(text)) return "virtual";
  if (/bluetooth|airpods|\bbuds\b|beats|hands-?free|\bbt\b|wh-1000|wf-1000|jabra|bose/.test(text)) return "bluetooth";
  if (/macbook|built-?in|internal|imac|mac mini|mac studio|microphone array|integrated/.test(text)) return "builtin";
  if (/external|usb|webcam|logitech|\bblue\b|yeti|rode|scarlett|focusrite|shure|hyperx|headset|headphone|line in|hdmi|displayport|thunderbolt|\bwired\b/.test(text)) return "external";
  return "unknown";
}

/** Audio inputs the user can choose from; the aliased "default"/"communications" entries are folded into "system default". */
export function toSelectableInputs(devices) {
  const inputs = [];
  for (const device of devices ?? []) {
    if (device?.kind !== "audioinput") continue;
    const id = normalizeDeviceId(device.deviceId);
    if (id === null || id === "default" || id === "communications") continue;
    inputs.push({ deviceId: id, label: typeof device.label === "string" && device.label.trim() !== "" ? device.label.trim() : `Microfone ${inputs.length + 1}` });
  }
  return inputs;
}

/** RMS of a time-domain buffer (shared by the setup meter and the engine). */
export function rmsOf(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export const testSignalLevel = 0.008;
export const testSilenceAfterMs = 4_000;
export const testRecentSignalMs = 1_200;

/** Test status from the elapsed time and the last time a signal was heard (null = never). Pure, for the setup meter. */
export function micTestStatus({ elapsedMs, lastSignalAtMs }) {
  if (lastSignalAtMs !== null && elapsedMs - lastSignalAtMs <= testRecentSignalMs) return "hearing";
  if (lastSignalAtMs === null && elapsedMs >= testSilenceAfterMs) return "silent";
  return "waiting";
}
