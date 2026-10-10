import { DEFAULT_INTERVIEWER_VOICE, INTERVIEWER_VOICE_OPTIONS, resolveInterviewerVoice } from "./voices.mjs";

/**
 * Interviewer voice choice on the setup: display names, grouping, sample files and the per-browser persistence
 * (localStorage, same approach as the microphone device; never sent anywhere except as `voice` in speech requests).
 */
export const interviewerVoiceStorageKey = "eia:interviewer-voice";

const accentLabels = { US: "americana", UK: "britânica" };
const genderLabels = { male: "masculina", female: "feminina" };

/** "am_echo" -> "Echo", "bf_emma" -> "Emma". */
export function voiceDisplayName(id) {
  const name = String(id ?? "").split("_").slice(1).join(" ");
  return name === "" ? String(id ?? "") : name.charAt(0).toUpperCase() + name.slice(1);
}

export function voiceAccentLabel(accent) {
  return accentLabels[accent] ?? "";
}

/** "masculina, americana". */
export function voiceTraits(option) {
  return [genderLabels[option.gender], accentLabels[option.accent]].filter(Boolean).join(", ");
}

/** "Echo · masculina, americana" for a known id (unknown ids fall back to the default voice). */
export function voiceSummary(id) {
  const resolved = resolveInterviewerVoice(id);
  const option = INTERVIEWER_VOICE_OPTIONS.find((voice) => voice.id === resolved);
  return `${voiceDisplayName(resolved)} · ${voiceTraits(option)}`;
}

/** [{ gender, label, voices }] in the order Masculinas, Femininas; the default voice comes first in its group. */
export function groupVoicesByGender(options = INTERVIEWER_VOICE_OPTIONS) {
  return [
    { gender: "male", label: "Masculinas" },
    { gender: "female", label: "Femininas" },
  ].map((group) => ({
    ...group,
    voices: options
      .filter((voice) => voice.gender === group.gender)
      .map((voice) => ({ ...voice, name: voiceDisplayName(voice.id), traits: voiceTraits(voice), isDefault: voice.id === DEFAULT_INTERVIEWER_VOICE })),
  })).filter((group) => group.voices.length > 0);
}

/** Static sample of a voice (same English sentence for all), served from /public: no API call. */
export function voiceSamplePath(id) {
  return `/voices/${resolveInterviewerVoice(id)}.mp3`;
}

/** The voice stored in this browser, or the default. */
export function readStoredInterviewerVoice(storage) {
  try { return resolveInterviewerVoice(storage.getItem(interviewerVoiceStorageKey)); } catch { return DEFAULT_INTERVIEWER_VOICE; }
}

/** Persists the choice (the default clears it). False when storage is unavailable. */
export function storeInterviewerVoice(storage, voice) {
  try {
    const id = resolveInterviewerVoice(voice);
    if (id === DEFAULT_INTERVIEWER_VOICE) storage.removeItem(interviewerVoiceStorageKey); else storage.setItem(interviewerVoiceStorageKey, id);
    return true;
  } catch { return false; }
}

/**
 * Plays the static sample of a voice (no speech API call, so testing voices costs nothing). `createAudio` is injectable
 * for tests. Resolves { status: "completed" } when it ends, { status: "unavailable", message } on a playback error and
 * { status: "cancelled" } after `cancel()`.
 */
export function playVoiceSample(id, createAudio = (src) => new Audio(src)) {
  const audio = createAudio(voiceSamplePath(id));
  let settle = () => {};
  let settled = false;
  const promise = new Promise((resolve) => {
    settle = (result) => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      resolve(result);
    };
  });
  const unavailable = () => settle({ status: "unavailable", message: "Não foi possível reproduzir o áudio neste dispositivo." });
  audio.onended = () => settle({ status: "completed" });
  audio.onerror = unavailable;
  Promise.resolve().then(() => audio.play()).catch(() => { if (!settled) unavailable(); });
  return {
    promise,
    cancel() {
      if (settled) return;
      audio.pause();
      settle({ status: "cancelled" });
    },
  };
}
