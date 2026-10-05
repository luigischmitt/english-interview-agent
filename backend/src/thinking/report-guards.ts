/**
 * Deterministic guards for the interview report. They protect against Whisper artifacts that the model
 * "corrects" as if they were candidate errors, wrong rule labels and gaps unrelated to the question.
 */

const functionWords = new Set([
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "many", "much", "more", "most", "each", "every", "no", "not", "all", "both", "other",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their", "mine", "yours", "ours", "theirs", "myself", "themselves",
  "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "having", "do", "does", "did", "will", "would", "can", "could", "should", "may", "might", "must", "shall",
  "don", "doesn", "didn", "isn", "aren", "wasn", "weren", "won", "couldn", "wouldn", "shouldn", "haven", "hasn", "hadn", "t", "m", "s", "re", "ve", "ll", "d",
  "in", "on", "at", "for", "to", "of", "with", "from", "by", "about", "into", "over", "under", "after", "before", "during", "since", "until", "as", "than", "through", "between", "within", "without", "across", "up", "down", "out", "off",
  "and", "or", "but", "so", "because", "if", "when", "while", "although", "which", "who", "whom", "whose", "what", "where", "how", "why", "then", "there", "here",
  "very", "also", "just", "too", "only", "even", "still", "already", "ever", "never", "always", "often", "well",
]);

/** Irregular verb forms mapped to their base form. */
const irregularBase: Record<string, string> = {
  chose: "choose", chosen: "choose", went: "go", gone: "go", made: "make", built: "build", wrote: "write", written: "write", ran: "run", saw: "see", seen: "see",
  took: "take", taken: "take", got: "get", gotten: "get", gave: "give", given: "give", knew: "know", known: "know", thought: "think", bought: "buy", taught: "teach",
  began: "begin", begun: "begin", led: "lead", sent: "send", spoke: "speak", spoken: "speak", found: "find", kept: "keep", brought: "bring", held: "hold", left: "leave",
  met: "meet", paid: "pay", said: "say", told: "tell", understood: "understand", read: "read", fell: "fall", felt: "feel", lost: "lose",
  lives: "life", people: "person", children: "child", grew: "grow", grown: "grow", drove: "drive", driven: "drive", broke: "break", broken: "break", set: "set", put: "put", cut: "cut", came: "come", become: "become", became: "become",
};
const irregularPastForms = new Set(Object.keys(irregularBase));

/** Lowercase tokens with their original spelling; contractions keep only their stem ("I'm" gives "i" + "m"). */
function tokenize(text: string): Array<{ lower: string; original: string }> {
  const tokens: Array<{ lower: string; original: string }> = [];
  for (const match of text.replace(/[’]/gu, "'").matchAll(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu)) {
    const original = match[0];
    const [stem, suffix] = original.split("'");
    tokens.push({ lower: stem!.toLowerCase(), original: stem! });
    if (suffix) tokens.push({ lower: suffix.toLowerCase(), original: suffix });
  }
  return tokens;
}

function lemmaCandidates(word: string): Set<string> {
  const base = irregularBase[word];
  const candidates = new Set<string>([word]);
  if (base) candidates.add(base);
  const add = (value: string) => { if (value.length >= 3) candidates.add(value); };
  if (word.endsWith("ies")) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es")) add(word.slice(0, -2));
  if (word.endsWith("s")) add(word.slice(0, -1));
  if (word.endsWith("ed")) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
  if (word.endsWith("ing")) { add(word.slice(0, -3)); add(`${word.slice(0, -3)}e`); }
  for (const value of [...candidates]) {
    if (/([^aeiou])\1$/u.test(value)) add(value.slice(0, -1));
  }
  return candidates;
}

function sameLemma(a: string, b: string): boolean {
  if (a === b) return true;
  const left = lemmaCandidates(a);
  for (const candidate of lemmaCandidates(b)) if (left.has(candidate)) return true;
  return false;
}

type Token = { lower: string; original: string };

/** Token-level diff through the longest common subsequence (answers are short). */
function diffTokens(before: Token[], after: Token[]): { removed: Token[]; added: Token[] } {
  const table: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i]!.lower === after[j]!.lower ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const removed: Token[] = [];
  const added: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i]!.lower === after[j]!.lower) { i += 1; j += 1; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { removed.push(before[i]!); i += 1; }
    else { added.push(after[j]!); j += 1; }
  }
  while (i < before.length) removed.push(before[i++]!);
  while (j < after.length) added.push(after[j++]!);
  return { removed, added };
}

const isContent = (token: Token) => !functionWords.has(token.lower) && !/^\d+$/u.test(token.lower);

export type EnglishEditAnalysis = {
  /** Content words of the excerpt that disappear and are not a verb/number form of an added word. */
  removedContent: Token[];
  /** Content words introduced by the rephrase that are not a verb/number form of a removed word. */
  addedContent: Token[];
  /** Subset of addedContent that does not appear anywhere in the full answer. */
  addedNew: Token[];
  /** Same-lemma pairs, for example choose to chose. */
  formChanges: Array<{ from: Token; to: Token }>;
  removedFunction: Token[];
  addedFunction: Token[];
  /** A removed capitalized word that is not a sentence start: a proper noun the rephrase replaces. */
  removedProperNoun: boolean;
  /** The excerpt repeats a token back to back ("I'm I'm"). */
  hasRepeatedToken: boolean;
};

export function analyzeEnglishEdit(excerpt: string, rephrased: string, fullAnswer: string): EnglishEditAnalysis {
  const before = tokenize(excerpt);
  const after = tokenize(rephrased);
  const { removed, added } = diffTokens(before, after);
  const removedContent = removed.filter(isContent);
  const addedContent = added.filter(isContent);
  const formChanges: EnglishEditAnalysis["formChanges"] = [];
  for (const from of [...removedContent]) {
    const matchIndex = addedContent.findIndex((candidate) => sameLemma(from.lower, candidate.lower));
    if (matchIndex < 0) continue;
    formChanges.push({ from, to: addedContent[matchIndex]! });
    addedContent.splice(matchIndex, 1);
    removedContent.splice(removedContent.indexOf(from), 1);
  }
  const answerTokens = tokenize(fullAnswer).map((token) => token.lower);
  const addedNew = addedContent.filter((token) => !answerTokens.some((word) => sameLemma(word, token.lower)));
  let hasRepeatedToken = false;
  for (let index = 1; index < before.length; index += 1) {
    if (before[index]!.lower === before[index - 1]!.lower && !["that", "had"].includes(before[index]!.lower)) hasRepeatedToken = true;
  }
  const evidenceIndex = fullAnswer.indexOf(excerpt);
  const startsSentence = evidenceIndex <= 0 || /(?:^|[.!?…]["'”’)]*\s+)$/u.test(fullAnswer.slice(0, evidenceIndex));
  const firstToken = before[0];
  const removedProperNoun = removedContent.some((token) => /^\p{Lu}/u.test(token.original) && token.original.length > 1 && token.original !== token.original.toUpperCase()
    && !(startsSentence && token === firstToken));
  return {
    removedContent, addedContent, addedNew, formChanges, removedProperNoun,
    removedFunction: removed.filter((token) => !isContent(token)),
    addedFunction: added.filter((token) => !isContent(token)),
    hasRepeatedToken,
  };
}

/**
 * True when the rephrase replaces or invents content words (a mis-heard noun or name, a garbled phrase) instead of
 * fixing grammar. Verb-form changes of the same lemma, function words and reordering never count.
 * `swapTolerant` allows a single one-for-one word swap (WORD_CHOICE and FALSE_COGNATE).
 */
export function isLikelyTranscriptionArtifactEdit(edit: EnglishEditAnalysis, swapTolerant: boolean): boolean {
  const removed = edit.removedContent.length;
  const added = edit.addedContent.length;
  const changedContent = removed + added;
  if (edit.hasRepeatedToken && changedContent > 0) return true;
  // Swapping a word for an acronym ("the gelsm" -> "the GLCM") fixes Whisper's spelling of a technical term, not the candidate.
  if (removed >= 1 && edit.addedContent.some((token) => /^[A-Z][A-Z0-9]+$/u.test(token.original))) return true;
  if (removed >= 3) return true;
  // A mis-heard proper noun (capitalized in the middle of the answer) is never a candidate error.
  if (edit.removedProperNoun && added > 0) return true;
  if (swapTolerant) return removed > 1 || edit.addedNew.length > 2;
  if (removed >= 1 && added >= 1) return true;
  return edit.addedNew.length >= 2;
}

const claimsGerund = /ger[úu]ndio|\b-?ing\b/iu;
const claimsAgreement = /concord[âa]ncia/iu;
const claimsPreposition = /preposi[çc][ãa]o|preposi[çc][õo]es/iu;
const prepositions = new Set(["in", "on", "at", "for", "to", "of", "with", "from", "by", "about", "into", "over", "under", "after", "before", "during", "since", "until", "through", "between", "within", "without", "across"]);
const beOrAgreementForms = new Set(["is", "are", "was", "were", "am", "has", "have", "does", "do"]);

/**
 * GRAMMAR sanity: a verb-form fix must not be labelled with the wrong rule. Returns the (possibly regenerated) suggestion,
 * or null when the label is wrong and no correct rule can be generated.
 */
export function checkGrammarRuleLabel(suggestion: string, edit: EnglishEditAnalysis, rephrased: string): string | null {
  const addedIng = [...edit.addedContent, ...edit.formChanges.map((change) => change.to)].some((token) => /ing$/u.test(token.lower));
  const agreementChange = [...edit.removedFunction, ...edit.addedFunction].some((token) => beOrAgreementForms.has(token.lower))
    || edit.formChanges.some(({ from, to }) => /^(?:s|es)$/u.test(to.lower.replace(from.lower, "")) || /^(?:s|es)$/u.test(from.lower.replace(to.lower, "")));
  // "Use a preposição correta" is the wrong rule when no preposition changed and a verb merely became its -ing form.
  const prepositionChange = [...edit.removedFunction, ...edit.addedFunction].some((token) => prepositions.has(token.lower));
  const ingChange = edit.formChanges.find(({ from, to }) => /ing$/u.test(to.lower) && !/ing$/u.test(from.lower));
  if (claimsPreposition.test(suggestion) && !prepositionChange && ingChange) {
    const after = tokenize(rephrased);
    const index = after.findIndex((token) => token.lower === ingChange.to.lower);
    const previous = index > 0 ? after[index - 1]!.lower : undefined;
    return previous && prepositions.has(previous)
      ? `Use o gerúndio (${ingChange.to.lower}) como substantivo após a preposição ${previous}: ${previous} ${ingChange.to.lower}.`
      : `Após preposição, use o gerúndio como substantivo: ${ingChange.to.lower}.`;
  }
  const wrongGerund = claimsGerund.test(suggestion) && !addedIng;
  const wrongAgreement = claimsAgreement.test(suggestion) && !agreementChange;
  if (!wrongGerund && !wrongAgreement) return suggestion;

  const purpose = edit.removedFunction.some((token) => token.lower === "for") && edit.addedFunction.some((token) => token.lower === "to");
  if (purpose) {
    const after = tokenize(rephrased);
    const toIndex = after.findIndex((token, index) => token.lower === "to" && after[index + 1] && isContent(after[index + 1]!));
    const verb = toIndex >= 0 ? after[toIndex + 1]!.original : undefined;
    if (verb) return `Use to + verbo base para indicar finalidade: to ${verb.toLowerCase()}.`;
  }
  const past = edit.formChanges.find(({ from, to }) => from.lower !== to.lower && (/ed$/u.test(to.lower) || irregularPastForms.has(to.lower)) && !(/ed$/u.test(from.lower) || irregularPastForms.has(from.lower)));
  if (past) return `Use o passado do verbo: o passado de ${past.from.lower} é ${past.to.lower}.`;
  return null;
}

/** A suggestion that talks about "correct project/product names" reveals a mis-heard proper noun. */
export function suggestsFixingNames(suggestion: string): boolean {
  return /nomes?\s+(?:corret|real|certo|exat|d[eo]s?\s+(?:projet|produt|ferrament|tecnolog))|nome\s+(?:correto|do projeto|do produto)|nomes? pr[óo]prios?/iu.test(suggestion);
}

const integrationClaim = /\b(?:integra\w*|implement\w*)\b|como (?:a |o )?[\p{L}\s]{0,30}(?:foi|era) (?:integrad|implementad)/iu;
const integrationQuestion = /\b(?:integrat\w*|implement\w*|build\w*|built|how (?:did|do|would|will) you|how (?:was|is))\b/iu;

/** A technical gap or priority about integration/implementation is unfair when the question did not ask for it. */
export function isOffQuestionIntegrationItem(text: string, question: string | undefined): boolean {
  if (!integrationClaim.test(text)) return false;
  return !(question && integrationQuestion.test(question));
}

/** A rephrase that equals the cited excerpt (ignoring case, punctuation and spacing) corrects nothing. */
export function isRephraseUnchanged(excerpt: string, rephrased: string): boolean {
  const normalize = (text: string) => expandContractions(tokenize(text).map((token) => token.lower)).join(" ");
  return normalize(excerpt) === normalize(rephrased);
}

const contractionSuffixes: Record<string, string> = { ve: "have", m: "am", re: "are", ll: "will" };
const pronounsBeforeIs = new Set(["it", "that", "what", "there", "he", "she", "here", "who", "where", "how", "this"]);
const negativeStems: Record<string, string> = { don: "do", doesn: "does", didn: "did", isn: "is", aren: "are", wasn: "was", weren: "were", haven: "have", hasn: "has", hadn: "had", couldn: "could", wouldn: "would", shouldn: "should", won: "will", can: "can" };

/** Spells contractions out ("I've" = "I have", "don't" = "do not"), so expanding one is never reported as a correction. */
function expandContractions(words: string[]): string[] {
  const expanded: string[] = [];
  for (const [index, word] of words.entries()) {
    const previous = words[index - 1];
    if (word === "t" && previous && negativeStems[previous]) { expanded[expanded.length - 1] = negativeStems[previous]!; expanded.push("not"); continue; }
    if (word === "s" && previous && pronounsBeforeIs.has(previous)) { expanded.push("is"); continue; }
    if (contractionSuffixes[word] && previous) { expanded.push(contractionSuffixes[word]!); continue; }
    if (word === "cannot") { expanded.push("can", "not"); continue; }
    expanded.push(word);
  }
  return expanded;
}

const workOnNouns = /^(?:\S+\s+){0,2}?(?:project|product|feature|app|application|platform|system|codebase|website|service|team|solution)s?\b/iu;

/** "work on a product/project" is already idiomatic; rewriting its "on" as "in" corrects nothing. */
export function isIdiomaticOnRewritten(excerpt: string, rephrased: string): boolean {
  const normalize = (text: string) => tokenize(text).map((token) => token.lower).join(" ");
  const target = normalize(rephrased);
  for (const match of excerpt.matchAll(/\bon\s+/giu)) {
    if (!workOnNouns.test(excerpt.slice(match.index! + match[0].length))) continue;
    const swapped = `${excerpt.slice(0, match.index)}in ${excerpt.slice(match.index! + match[0].length)}`;
    if (normalize(swapped) === target) return true;
  }
  return false;
}

/** A "correction" that is itself wrong English, such as the Portuguese "para" calque "for to do". */
export function isUngrammaticalRephrase(rephrased: string): boolean {
  return /\bfor\s+to\s+\p{L}+/iu.test(rephrased);
}

/** A garbled excerpt: Whisper cut a sentence and restarted in lowercase ("a data. a little expensive project"). */
export function hasBrokenSentenceBoundary(text: string): boolean {
  return /[\p{L}\p{N}]{2,}[.!?]\s+\p{Ll}/u.test(text.replace(/\b(?:e\.g|i\.e|etc|vs)\./giu, ""));
}

const genericExercisePatterns = [
  /^\s*pratique\s+explicar\s+como\s+(?:suas?|seus?)\s+(?:habilidades?|conhecimentos?|experi[êe]ncias?|compet[êe]ncias?)/iu,
  /pratique\s+(?:a\s+)?(?:usar|utilizar|usa)\s+[^"“:]{0,60}\bcorret\w*\s+em\s+(?:suas?\s+)?frases/iu,
  /resolvem\s+problemas\s+espec[íi]ficos\s+d[oa]\s+(?:cargo|vaga|posi[çc][ãa]o)/iu,
  /^\s*pratique\s+(?:falar|responder|explicar|se\s+comunicar)\s+(?:com\s+mais\s+clareza|de\s+forma\s+(?:mais\s+)?clara|melhor)\b/iu,
];

/** A priority exercise that names no concrete structure or scenario (for example "Pratique explicar como suas habilidades...") is not actionable. */
export function isGenericExercise(exercise: string): boolean {
  return genericExercisePatterns.some((pattern) => pattern.test(exercise));
}
