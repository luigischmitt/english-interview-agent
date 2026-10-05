/**
 * Detects the whitespace degeneration loop some providers fall into in JSON mode
 * (valid JSON start, then thousands of tabs/spaces until max_tokens). Content-free:
 * only inspects structure, never returns text.
 */
export const degenerateWhitespaceRun = 40;

export function hasDegenerateWhitespace(content: unknown): boolean {
  if (typeof content !== "string") return false;
  let inString = false;
  let escaped = false;
  let run = 0;
  for (const char of content) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; run = 0; continue; }
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      run += 1;
      if (run >= degenerateWhitespaceRun) return true;
    } else run = 0;
  }
  return false;
}

/** Degenerate output: a long whitespace run, or a length cut-off whose content is whitespace-dominated. */
export function isDegenerateProviderOutput(content: unknown, finishReason: unknown): boolean {
  if (hasDegenerateWhitespace(content)) return true;
  return finishReason === "length" && typeof content === "string" && content.length > 0 && content.trim().length / content.length < 0.2;
}
