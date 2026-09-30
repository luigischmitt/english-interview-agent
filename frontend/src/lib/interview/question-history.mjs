const questionStopWords = new Set(["a", "about", "an", "and", "are", "as", "at", "can", "could", "describe", "did", "do", "for", "from", "give", "had", "have", "how", "i", "in", "is", "it", "me", "of", "on", "or", "please", "tell", "that", "the", "there", "to", "was", "way", "what", "when", "where", "which", "who", "why", "with", "would", "you", "your"]);

function canonicalQuestionWords(question) {
  const words = question.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
  const canonical = words.map((word) => {
    if (["teammate", "colleague", "coworker", "coworkers", "teammates", "colleagues"].includes(word)) return "team";
    if (["conflict", "disagreement", "disagree", "disputes", "argument"].includes(word)) return "disagreement";
    if (["problems", "issue", "issues", "challenge", "challenges", "difficulties"].includes(word)) return "problem";
    if (["learned", "learning", "learnt"].includes(word)) return "learn";
    if (["handled", "handling", "resolved", "resolving", "managed"].includes(word)) return "resolve";
    if (["technologies", "technology", "tools"].includes(word)) return "technology";
    if (["projects", "project"].includes(word)) return "project";
    if (["decisions", "decision"].includes(word)) return "decision";
    return word;
  });
  return new Set(canonical.filter((word) => word.length > 2 && !questionStopWords.has(word)));
}

// Keep the token normalization and overlap thresholds in sync with the backend.
export function repeatsAskedQuestion(question, askedQuestions = []) {
  const candidateWords = canonicalQuestionWords(question);
  if (candidateWords.size === 0) return false;
  return askedQuestions.some((asked) => {
    const askedWords = canonicalQuestionWords(asked);
    if (askedWords.size === 0) return false;
    const shared = [...candidateWords].filter((word) => askedWords.has(word)).length;
    const overlap = shared / Math.min(candidateWords.size, askedWords.size);
    const jaccard = shared / (candidateWords.size + askedWords.size - shared);
    return overlap >= 0.78 || (shared >= 3 && jaccard >= 0.62);
  });
}

export function firstUnaskedQuestion(candidates = [], askedQuestions = []) {
  return candidates.find((question) => !repeatsAskedQuestion(question, askedQuestions)) ?? null;
}
