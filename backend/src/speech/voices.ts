/** Azure public identifiers with equivalent Kokoro voices for an OpenRouter fallback. Keep in sync with the frontend. */
export const defaultInterviewerVoice = "en-US-AndrewNeural";

export type SelectableVoiceInfo = { id: string; kokoroVoice: string; gender: "male" | "female"; accent: "US" | "UK" };

export const selectableVoiceList: readonly SelectableVoiceInfo[] = [
  { id: "en-US-AndrewNeural", kokoroVoice: "am_echo", gender: "male", accent: "US" },
  { id: "en-US-BrianNeural", kokoroVoice: "am_michael", gender: "male", accent: "US" },
  { id: "en-US-GuyNeural", kokoroVoice: "am_eric", gender: "male", accent: "US" },
  { id: "en-GB-RyanNeural", kokoroVoice: "bm_george", gender: "male", accent: "UK" },
  { id: "en-US-AvaNeural", kokoroVoice: "af_heart", gender: "female", accent: "US" },
  { id: "en-US-EmmaNeural", kokoroVoice: "af_bella", gender: "female", accent: "US" },
  { id: "en-US-JennyNeural", kokoroVoice: "af_sarah", gender: "female", accent: "US" },
  { id: "en-GB-SoniaNeural", kokoroVoice: "bf_emma", gender: "female", accent: "UK" },
];

export const selectableVoices: readonly string[] = selectableVoiceList.map((voice) => voice.id);
const legacyKokoroVoices = new Set(selectableVoiceList.map((voice) => voice.kokoroVoice));

export function isSelectableVoice(value: unknown): value is string {
  return typeof value === "string" && selectableVoices.includes(value);
}

/** The requested voice when it is selectable, otherwise `fallback` (the configured default). */
export function resolveVoice(requested: unknown, fallback: string): string {
  return isSelectableVoice(requested) ? requested : fallback;
}

/** The Kokoro counterpart of a selectable Azure voice; no untrusted client value reaches a provider. */
export function resolveKokoroVoice(requested: unknown, fallback: string): string {
  if (typeof requested === "string" && legacyKokoroVoices.has(requested)) return requested;
  return selectableVoiceList.find((voice) => voice.id === requested)?.kokoroVoice ?? fallback;
}
