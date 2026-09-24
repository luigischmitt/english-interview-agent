function normalizeToken(token) {
  return token.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}']/gu, "");
}

/** Merge the repeated speech at the boundary of adjacent Whisper audio windows. */
export function mergeTranscriptWindow(previous, next) {
  const currentText = previous.trim();
  const nextText = next.trim();
  if (!currentText) return nextText;
  if (!nextText) return currentText;

  const previousWords = currentText.split(/\s+/u);
  const nextWords = nextText.split(/\s+/u);
  const previousNormalized = previousWords.map(normalizeToken);
  const nextNormalized = nextWords.map(normalizeToken);
  const maximumOverlap = Math.min(previousWords.length, nextWords.length, 20);
  let overlap = 0;
  for (let size = maximumOverlap; size >= 2; size -= 1) {
    const suffix = previousNormalized.slice(-size);
    const prefix = nextNormalized.slice(0, size);
    if (suffix.every((token, index) => token && token === prefix[index])) {
      overlap = size;
      break;
    }
  }

  const addition = nextWords.slice(overlap).join(" ");
  return addition ? `${currentText} ${addition}`.trim() : currentText;
}
