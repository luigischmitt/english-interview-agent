export const defaultCandidateVoicePreferences = {
  showCandidateTranscript: true,
  autoCaptureVoice: true,
};

export function resolveCandidateVoicePreferences(config) {
  return {
    showCandidateTranscript: typeof config.showCandidateTranscript === "boolean"
      ? config.showCandidateTranscript
      : typeof config.transcribeCandidateVoice === "boolean"
        ? config.transcribeCandidateVoice
        : defaultCandidateVoicePreferences.showCandidateTranscript,
    autoCaptureVoice: typeof config.autoCaptureVoice === "boolean"
      ? config.autoCaptureVoice
      : defaultCandidateVoicePreferences.autoCaptureVoice,
  };
}
