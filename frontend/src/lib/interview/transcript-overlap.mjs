function normalizeToken(token) {
  return token.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}']/gu, "");
}

const overlapFillers = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or"]);

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
  for (let size = maximumOverlap; size >= 2; size -= 1) {
    const suffix = previousNormalized.slice(-size);
    const prefix = nextNormalized.slice(0, size);
    if (suffix.every((token, index) => token && token === prefix[index])) {
      const addition = nextWords.slice(size).join(" ");
      return addition ? `${currentText} ${addition}`.trim() : currentText;
    }
  }

  for (let size = maximumOverlap; size >= 4; size -= 1) {
    if (nextWords.length < size + 1) continue;
    const suffix = previousNormalized.slice(-size);
    const prefix = nextNormalized.slice(0, size + 1);
    for (let insertion = 1; insertion < size; insertion += 1) {
      if (!overlapFillers.has(prefix[insertion])) continue;
      const aligned = [...prefix.slice(0, insertion), ...prefix.slice(insertion + 1)];
      if (suffix.every((token, index) => token && token === aligned[index])) {
        const preservedPrefix = previousWords.slice(0, previousWords.length - size);
        return [...preservedPrefix, ...nextWords].join(" ").trim();
      }
    }
  }

  return `${currentText} ${nextText}`.trim();
}
