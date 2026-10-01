export const defaultCandidateVoicePreferences: {
  autoCaptureVoice: boolean;
  showCandidateCaptions: boolean;
};
export function resolveCandidateVoicePreferences(config: {
  autoCaptureVoice?: boolean;
  showCandidateCaptions?: boolean;
}): {
  autoCaptureVoice: boolean;
  showCandidateCaptions: boolean;
};
