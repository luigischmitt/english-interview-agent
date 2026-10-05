/**
 * Whisper vocabulary biasing. OpenAI-compatible Whisper accepts a `prompt` (only its last ~224 tokens matter) that nudges
 * spelling of product names and technical terms ("Supabase", not "Superbase"). It contains only a static glossary, the
 * interviewer question and the candidate's own earlier transcript of the same answer. It is never logged.
 */
export const whisperGlossary = [
  "Supabase", "Vercel", "Next.js", "Node.js", "React", "TypeScript", "JavaScript", "PostgreSQL", "MongoDB", "Redis",
  "Docker", "Kubernetes", "AWS", "GCP", "Azure", "GitHub", "CI/CD", "REST API", "GraphQL", "OAuth", "JWT",
  "microservices", "Kafka", "Terraform", "LLM", "OpenAI", "Gemini", "LangChain", "RAG", "embeddings", "WhatsApp",
  "Python", "Django", "FastAPI", "Java", "Spring Boot", "Go", "Rust", "Flutter", "Swift", "Kotlin", "SQL", "NoSQL",
  "frontend", "backend", "deploy", "rollback", "latency", "throughput",
] as const;

const header = "Technical job interview answer.";
const maxPromptChars = 800;
const maxQuestionChars = 200;
const maxPreviousChars = 200;

export type WhisperPromptContext = {
  /** Interviewer question of the current answer. */
  question?: string | null;
  /** Transcript of the earlier part of this same answer (the tail is used). */
  previousText?: string;
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function headWords(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trim();
}

function tailWords(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(text.length - limit);
  const space = cut.indexOf(" ");
  return (space >= 0 ? cut.slice(space + 1) : cut).trim();
}

/** Builds the prompt, at most 800 characters; the glossary shrinks first, so the question and continuity stay intact. */
export function buildWhisperPrompt(context: WhisperPromptContext = {}): string {
  const question = headWords(clean(context.question ?? ""), maxQuestionChars);
  const previous = tailWords(clean(context.previousText ?? ""), maxPreviousChars);
  const tail = `${question ? ` Question: ${question}` : ""}${previous ? ` Previous: ${previous}` : ""}`;
  const termsPrefix = ` Terms: `;
  let budget = maxPromptChars - header.length - termsPrefix.length - tail.length - 1;
  const terms: string[] = [];
  for (const term of whisperGlossary) {
    const cost = term.length + (terms.length ? 2 : 0);
    if (cost > budget) break;
    terms.push(term);
    budget -= cost;
  }
  return `${header}${terms.length ? `${termsPrefix}${terms.join(", ")}.` : ""}${tail}`.slice(0, maxPromptChars);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const normalizedHeader = normalize(header);
const normalizedGlossary = normalize(whisperGlossary.join(" "));

/**
 * Whisper sometimes parrots its prompt on near-silent audio. True when the transcript is the prompt (or part of it), starts
 * with its fixed header, or is a run of at least four glossary terms with nothing else.
 */
export function isWhisperPromptEcho(transcript: string, prompt: string | null): boolean {
  const text = normalize(transcript);
  if (!text) return false;
  if (text.startsWith(normalizedHeader)) return true;
  if (prompt) {
    const normalizedPrompt = normalize(prompt);
    if (text === normalizedPrompt) return true;
    if (text.split(" ").length >= 6 && normalizedPrompt.includes(text)) return true;
  }
  return text.split(" ").length >= 4 && normalizedGlossary.includes(text);
}
