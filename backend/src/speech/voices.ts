/**
 * Voices a client may pick for the interviewer (OpenRouter Kokoro ids). Anything else (free text, blends, unknown ids)
 * falls back to the default, and only these ids are ever passed to a speech provider on a client's behalf.
 * Keep in sync with frontend/src/lib/interview/voices.mjs, which the setup screen renders.
 */
export const defaultInterviewerVoice = "am_echo";

export type SelectableVoiceInfo = { id: string; gender: "male" | "female"; accent: "US" | "UK" };

export const selectableVoiceList: readonly SelectableVoiceInfo[] = [
  { id: "am_echo", gender: "male", accent: "US" },
  { id: "am_michael", gender: "male", accent: "US" },
  { id: "am_puck", gender: "male", accent: "US" },
  { id: "am_liam", gender: "male", accent: "US" },
  { id: "am_eric", gender: "male", accent: "US" },
  { id: "am_adam", gender: "male", accent: "US" },
  { id: "am_onyx", gender: "male", accent: "US" },
  { id: "am_fenrir", gender: "male", accent: "US" },
  { id: "bm_fable", gender: "male", accent: "UK" },
  { id: "bm_george", gender: "male", accent: "UK" },
  { id: "bm_lewis", gender: "male", accent: "UK" },
  { id: "bm_daniel", gender: "male", accent: "UK" },
  { id: "af_heart", gender: "female", accent: "US" },
  { id: "af_bella", gender: "female", accent: "US" },
  { id: "af_nicole", gender: "female", accent: "US" },
  { id: "af_sarah", gender: "female", accent: "US" },
  { id: "af_aoede", gender: "female", accent: "US" },
  { id: "af_kore", gender: "female", accent: "US" },
  { id: "bf_emma", gender: "female", accent: "UK" },
  { id: "bf_isabella", gender: "female", accent: "UK" },
];

export const selectableVoices: readonly string[] = selectableVoiceList.map((voice) => voice.id);

export function isSelectableVoice(value: unknown): value is string {
  return typeof value === "string" && selectableVoices.includes(value);
}

/** The requested voice when it is selectable, otherwise `fallback` (the configured default). */
export function resolveVoice(requested: unknown, fallback: string): string {
  return isSelectableVoice(requested) ? requested : fallback;
}
