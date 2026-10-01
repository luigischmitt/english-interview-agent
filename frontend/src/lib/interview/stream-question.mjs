export const maximumStreamQuestionCharacters = 400;

/**
 * Interviewer question sent in the stream `start` message so the backend can judge whether the answer is finished.
 * Control characters become spaces; an empty value yields null; longer text is cut at the limit on a word boundary.
 * @param {unknown} question
 * @returns {string | null}
 */
export function toStreamQuestion(question) {
  if (typeof question !== "string") return null;
  const text = question.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text) return null;
  if (text.length <= maximumStreamQuestionCharacters) return text;
  const cut = text.slice(0, maximumStreamQuestionCharacters);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maximumStreamQuestionCharacters / 2 ? cut.slice(0, lastSpace) : cut).trim();
}
