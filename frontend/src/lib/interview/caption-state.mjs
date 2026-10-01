// Display-only live caption of the candidate's speech (Cartesia Ink-2). Never persisted, logged or submitted:
// the canonical `complete` transcript is the only text used for follow-ups, reports and storage.

export const emptyCaption = Object.freeze({ committed: "", partial: "" });
export const maximumCaptionCharacters = 4_000;

function clean(value) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > maximumCaptionCharacters ? text.slice(text.length - maximumCaptionCharacters) : text;
}

/** Returns a normalized caption from a `caption` stream message, or null when the message is not a caption. */
export function parseCaptionMessage(message) {
  if (!message || typeof message !== "object" || message.type !== "caption") return null;
  return { committed: clean(message.committed), partial: clean(message.partial) };
}

/** Keeps the previous object when nothing changed so React skips the render; null/invalid input clears. */
export function reduceCaption(previous, next) {
  const target = next && typeof next === "object" ? { committed: clean(next.committed), partial: clean(next.partial) } : emptyCaption;
  if (previous && previous.committed === target.committed && previous.partial === target.partial) return previous;
  if (!target.committed && !target.partial) return previous && !previous.committed && !previous.partial ? previous : emptyCaption;
  return target;
}

export function hasCaptionText(caption) {
  return Boolean(caption && (caption.committed || caption.partial));
}

/** The caption is shown only while the toggle is on, the answer is being captured and text has been received. */
export function shouldShowCandidateCaption({ enabled, captureState, caption }) {
  return enabled === true && (captureState === "listening" || captureState === "detected") && hasCaptionText(caption);
}
