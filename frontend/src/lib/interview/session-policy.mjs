export function hasReachedTimeLimit(elapsedSeconds, durationMinutes) {
  return elapsedSeconds >= Math.max(5, durationMinutes) * 60;
}

export function canStartNextQuestion(elapsedSeconds, durationMinutes, nextIndex, questionCount) {
  return !hasReachedTimeLimit(elapsedSeconds, durationMinutes) && nextIndex < questionCount;
}

export function createOnceGate() {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

export function nextAutoStartSignal(signal, disabled, lastSignal) {
  return signal !== null && !disabled && signal !== lastSignal ? signal : null;
}

export function finalTranscriptForSubmission(transcription) {
  if (transcription?.status !== "available") return null;
  const transcript = transcription.value?.transcript?.trim();
  return transcript || null;
}

export function canSkipVoiceQuestion(captureState, transcriptionStatus) {
  const activeCaptureStates = ["requesting", "listening", "detected", "finalizing"];
  const unfinishedTranscriptionStates = ["pending"];
  return !activeCaptureStates.includes(captureState) && !unfinishedTranscriptionStates.includes(transcriptionStatus);
}

export function stopMediaStreamTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function nullableQuestionCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count > 0 ? count : null;
}

export const interviewDurationOptions = [5, 10, 15, 25];
