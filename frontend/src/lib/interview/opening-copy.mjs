// Natural English for the interviewer's opening and for questions that mention the candidate's role. The role is free text
// typed by the candidate (often Portuguese, often already carrying a seniority word), so it is only spoken when it reads
// as an English job title; otherwise the interviewer says "this role".

const normalize = (text) => text.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/gu, "");

// English and Portuguese seniority words (accent-insensitive: "sênior" -> "senior").
const seniorityWords = /\b(?:junior|jr|mid|mid-level|midlevel|pleno|pl|senior|sr|staff|lead|principal|especialista|trainee|estagiario|intern)\b/u;

// Words that give a Portuguese job title away; English titles contain none of them.
const portugueseWords = /\b(?:analista|desenvolvedor|desenvolvedora|engenheiro|engenheira|gerente|arquiteto|arquiteta|dados|coordenador|coordenadora|lider|programador|programadora|suporte|qualidade|seguranca|infraestrutura|nuvem|tecnologia|projetos|produto|de|da|do|das|dos|em|para|com)\b/u;

/** True when the typed role contains a seniority word in English or Portuguese ("Senior Backend Engineer", "Analista Pleno"). */
export function hasSeniorityWord(role) {
  return seniorityWords.test(normalize(role));
}

/** True when the typed role looks Portuguese (accented letters or Portuguese job-title words). */
export function looksPortuguese(role) {
  return /[ãõçáéíóúâêô]/iu.test(role) || portugueseWords.test(normalize(role));
}

/**
 * "this role" when the role is empty or Portuguese; otherwise "{seniority} {role} role", where the seniority label is
 * added only if the role does not already carry a seniority word (never "senior Senior Engineer role").
 */
export function describeRoleForSpeech(role, seniorityLabel) {
  const text = role?.trim() ?? "";
  if (!text || looksPortuguese(text)) return { phrase: "this role", personal: false };
  const withSeniority = seniorityLabel && !hasSeniorityWord(text) ? `${seniorityLabel} ${text}` : text;
  return { phrase: /\brole$/iu.test(withSeniority) ? withSeniority : `${withSeniority} role`, personal: true };
}

// Only the focus areas that read naturally as a clause; "mixed" (balanced practice) and unknown values add nothing.
const focusPhrases = {
  "technical-depth": "technical depth",
  communication: "clear communication",
  behavioral: "behavioral questions",
};

/** ", with a focus on technical depth" for the known focus areas; an empty string for mixed or unknown values. */
export function focusClause(focus) {
  const phrase = focusPhrases[focus?.trim?.() ?? ""];
  return phrase ? `, with a focus on ${phrase}` : "";
}

/** The typed role as it may be spliced into an English sentence ("strong fit for {role}"): "this role" when empty or Portuguese. */
export function roleForSpeech(role) {
  const text = role?.trim() ?? "";
  return !text || looksPortuguese(text) ? "this role" : text;
}
