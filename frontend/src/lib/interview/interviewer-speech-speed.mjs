export const DEFAULT_INTERVIEWER_SPEECH_SPEED = 1;
export const interviewerSpeechSpeedStorageKey = "eia:interviewer-speech-speed";
export const INTERVIEWER_SPEECH_SPEEDS = [0.8, 0.9, 1, 1.1];

export function resolveInterviewerSpeechSpeed(speed) {
  return INTERVIEWER_SPEECH_SPEEDS.includes(speed) ? speed : DEFAULT_INTERVIEWER_SPEECH_SPEED;
}

export function readStoredInterviewerSpeechSpeed(storage) {
  try { return resolveInterviewerSpeechSpeed(Number(storage.getItem(interviewerSpeechSpeedStorageKey))); } catch { return DEFAULT_INTERVIEWER_SPEECH_SPEED; }
}

export function storeInterviewerSpeechSpeed(storage, speed) {
  try {
    const value = resolveInterviewerSpeechSpeed(speed);
    if (value === DEFAULT_INTERVIEWER_SPEECH_SPEED) storage.removeItem(interviewerSpeechSpeedStorageKey); else storage.setItem(interviewerSpeechSpeedStorageKey, String(value));
    return true;
  } catch { return false; }
}
