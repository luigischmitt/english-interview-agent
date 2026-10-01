export const defaultCandidateVoicePreferences = {
  autoCaptureVoice: true,
  showCandidateCaptions: true,
};

export function resolveCandidateVoicePreferences(config) {
  return {
    autoCaptureVoice: typeof config.autoCaptureVoice === "boolean"
      ? config.autoCaptureVoice
      : defaultCandidateVoicePreferences.autoCaptureVoice,
    showCandidateCaptions: typeof config.showCandidateCaptions === "boolean"
      ? config.showCandidateCaptions
      : defaultCandidateVoicePreferences.showCandidateCaptions,
  };
}
