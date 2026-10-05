/**
 * Text as it is spoken. Captions and transcripts keep the original; only synthesis sees this form.
 * A slash between two word characters is read as a pause, not the word "slash" ("CI/CD" -> "CI CD", "24/7" -> "24 7").
 * URLs ("://") and paths (leading "/") are left untouched.
 */
export function normalizeTextForSpeech(text: string): string {
  return text.split(/(\s+)/u).map((token) => (token.includes("://") || token.startsWith("/") ? token : token.replace(/(?<=[\p{L}\p{N}_])\/(?=[\p{L}\p{N}_])/gu, " "))).join("");
}
