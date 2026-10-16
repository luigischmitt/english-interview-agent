/** Validate the optional transcript-review message from the transcription stream. */
export function parseReviewedTranscript(message) {
  if (!message || typeof message !== "object") return null;
  if (message.type !== "reviewed_transcript" || message.status === "unavailable" || typeof message.transcript !== "string") return null;
  const transcript = message.transcript.trim();
  return transcript.length >= 1 && transcript.length <= 6000 ? transcript : null;
}
