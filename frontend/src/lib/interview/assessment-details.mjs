const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function validateAssessmentDetails(value) {
  const source = record(value) ? value : {};
  const parsedSentences = Array.isArray(source.sentences) ? source.sentences.flatMap((item) => {
    if (!record(item) || !Number.isSafeInteger(item.sentenceIndex) || item.sentenceIndex < 0 || typeof item.text !== "string" || !finite(item.startMs) || !finite(item.endMs) || item.startMs < 0 || item.endMs < item.startMs || !finite(item.score) || !Array.isArray(item.problemWords)) return [];
    const problemWords = item.problemWords.flatMap((word) => record(word) && typeof word.word === "string" && (word.score === null || finite(word.score)) && (word.errorType === null || typeof word.errorType === "string") && (word.worstPhoneme === null || typeof word.worstPhoneme === "string") ? [{ word: word.word, score: word.score, errorType: word.errorType, worstPhoneme: word.worstPhoneme }] : []).slice(0, 20);
    return [{ sentenceIndex: item.sentenceIndex, text: item.text, startMs: item.startMs, endMs: item.endMs, score: item.score, problemWords }];
  }).slice(0, 5) : [];
  const d = source.delivery;
  const delivery = record(d) && [d.wordsPerMinute, d.pauseCount, d.longestPauseMs, d.startDelayMs, d.fillerCount].every(finite) && record(d.fillers) && Object.entries(d.fillers).every(([key, count]) => key.length <= 80 && Number.isSafeInteger(count) && count >= 0)
    ? { wordsPerMinute: d.wordsPerMinute, pauseCount: d.pauseCount, longestPauseMs: d.longestPauseMs, startDelayMs: d.startDelayMs, fillerCount: d.fillerCount, fillers: d.fillers } : undefined;
  const parsedClips = Array.isArray(source.clips) ? source.clips.flatMap((clip) => record(clip) && Number.isSafeInteger(clip.sentenceIndex) && clip.sentenceIndex >= 0 && finite(clip.startMs) && finite(clip.endMs) && clip.startMs >= 0 && clip.endMs >= clip.startMs && clip.mimeType === "audio/webm;codecs=opus" && typeof clip.base64 === "string" && clip.base64.length <= 400000 ? [{ sentenceIndex: clip.sentenceIndex, startMs: clip.startMs, endMs: clip.endMs, mimeType: clip.mimeType, base64: clip.base64 }] : []).slice(0, 2) : [];
  return { ...(parsedSentences.length ? { sentences: parsedSentences } : {}), ...(delivery ? { delivery } : {}), ...(parsedClips.length ? { clips: parsedClips } : {}) };
}
