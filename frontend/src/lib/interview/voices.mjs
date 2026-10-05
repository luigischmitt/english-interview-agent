// Interviewer voices a candidate may choose (OpenRouter Kokoro ids). Keep in sync with backend/src/speech/voices.ts:
// the server only honours these ids and falls back to its configured default for anything else.
export const DEFAULT_INTERVIEWER_VOICE = "am_echo";

/** One entry per selectable voice: id, gender ("male" | "female") and accent ("US" | "UK"); the setup screen renders this list. */
export const INTERVIEWER_VOICE_OPTIONS = [
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

export const INTERVIEWER_VOICES = INTERVIEWER_VOICE_OPTIONS.map((voice) => voice.id);

/** The chosen voice when it is a known one, otherwise the default. */
export function resolveInterviewerVoice(voice) {
  return INTERVIEWER_VOICES.includes(voice) ? voice : DEFAULT_INTERVIEWER_VOICE;
}
