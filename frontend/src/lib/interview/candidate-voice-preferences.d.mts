export const defaultCandidateVoicePreferences: {
  showCandidateTranscript: boolean;
  autoCaptureVoice: boolean;
};
export function resolveCandidateVoicePreferences(config: {
  showCandidateTranscript?: boolean;
  transcribeCandidateVoice?: boolean;
  autoCaptureVoice?: boolean;
}): {
  showCandidateTranscript: boolean;
  autoCaptureVoice: boolean;
};
