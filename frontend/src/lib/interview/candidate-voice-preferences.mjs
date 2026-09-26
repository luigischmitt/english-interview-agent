export const defaultCandidateVoicePreferences = {
  autoCaptureVoice: true,
};

export function resolveCandidateVoicePreferences(config) {
  return {
    autoCaptureVoice: typeof config.autoCaptureVoice === "boolean"
      ? config.autoCaptureVoice
      : defaultCandidateVoicePreferences.autoCaptureVoice,
  };
}
