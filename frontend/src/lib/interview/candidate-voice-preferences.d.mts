export const defaultCandidateVoicePreferences: {
  autoCaptureVoice: boolean;
};
export function resolveCandidateVoicePreferences(config: {
  autoCaptureVoice?: boolean;
}): {
  autoCaptureVoice: boolean;
};
