/** Head and tail of an earlier answer: a project is usually described at the start, conclusions at the end (fits the 500-char cap). */
export function condensePreviousAnswer(answer) {
  const text = String(answer ?? "").trim();
  return text.length <= 485 ? text : `${text.slice(0, 240).trimEnd()} … ${text.slice(-240).trimStart()}`;
}
