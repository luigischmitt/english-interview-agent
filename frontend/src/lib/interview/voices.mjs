// Azure identifiers are sent to the backend; kokoroVoice keeps the OpenRouter fallback close to the chosen voice.
export const DEFAULT_INTERVIEWER_VOICE = "en-US-AndrewNeural";

/** One entry per selectable voice: id, gender ("male" | "female") and accent ("US" | "UK"); the setup screen renders this list. */
export const INTERVIEWER_VOICE_OPTIONS = [
  { id: "en-US-AndrewNeural", kokoroVoice: "am_echo", gender: "male", accent: "US" },
  { id: "en-US-BrianNeural", kokoroVoice: "am_michael", gender: "male", accent: "US" },
  { id: "en-US-GuyNeural", kokoroVoice: "am_eric", gender: "male", accent: "US" },
  { id: "en-GB-RyanNeural", kokoroVoice: "bm_george", gender: "male", accent: "UK" },
  { id: "en-US-AvaNeural", kokoroVoice: "af_heart", gender: "female", accent: "US" },
  { id: "en-US-EmmaNeural", kokoroVoice: "af_bella", gender: "female", accent: "US" },
  { id: "en-US-JennyNeural", kokoroVoice: "af_sarah", gender: "female", accent: "US" },
  { id: "en-GB-SoniaNeural", kokoroVoice: "bf_emma", gender: "female", accent: "UK" },
];

export const INTERVIEWER_VOICES = INTERVIEWER_VOICE_OPTIONS.map((voice) => voice.id);

/** The chosen voice when it is a known one, otherwise the default. */
export function resolveInterviewerVoice(voice) {
  return INTERVIEWER_VOICES.includes(voice) ? voice : DEFAULT_INTERVIEWER_VOICE;
}
