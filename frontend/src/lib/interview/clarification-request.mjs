// Deterministic detector for "can you repeat / I did not understand / what does X mean" said by the candidate.
// It is intentionally conservative: only SHORT utterances whose whole content is a clarification request qualify,
// so a real answer that merely contains "repeat" or "what do you mean" is never classified. English and Portuguese,
// tolerant to common Whisper mistakes ("repit", missing apostrophes, accents).

/** Utterances longer than this (in words) are answers, never clarification requests. */
export const maxClarificationWords = 20;

/** Lowercase, no accents, apostrophes split ("didn't" -> "didn t"), punctuation to spaces. */
function normalize(text) {
  return text.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/gu, "").replace(/['’`]/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const leadIn = "(?:(?:can|could|would|will|may) (?:you|i)(?: please| kindly| maybe| just)*|please|kindly|do you mind|would you mind|you can|can i ask you to|i need you to|i would like you to|i d like you to|you could|pode|poderia|podia|consegue|voce pode|voce poderia|da pra|por favor)";
const lead = `(?:${leadIn} )?(?:please |por favor )?`;
const repeatVerb = "(?:repeat|repeating|repit|repeet|repet|repeate|repeats|ripeat|ripit|repete|repita|repetir)";
const thing = "(?:that|it|this|the question|the last question|your question|the question for me|what you said|what you just said|the last part|the sentence|the last sentence|that question|the first part|everything|the whole question|a pergunta|essa pergunta|isso)";
const againTail = "(?:again|one more time|once more|one more|please|for me|slowly|more slowly|slower|a little slower|a bit slower|de novo|novamente|mais uma vez|uma vez mais|por favor|pra mim|para mim|devagar|mais devagar)";

const repeatPatterns = [
  new RegExp(`^${lead}${repeatVerb}(?: ${thing})?(?: ${againTail})*$`, "u"),
  new RegExp(`^${lead}(?:say|tell|ask|read|play|go over|run|falar|dizer|perguntar|ler)(?: me)?(?: ${thing})? (?:again|one more time|once more|one more|more slowly|slower|a little slower|de novo|novamente|mais uma vez)(?: please)?$`, "u"),
  // Exact short phrases (what a person says when they just did not catch it).
  /^(?:one more time|once more|again|come again(?: please)?|pardon(?: me)?|beg your pardon|i beg your pardon|what|what was that|what was it|what was the question|what is the question|what was your question|what did you say|what did you ask|what did you just say|say what|huh|excuse me|sorry|sorry what|what sorry|wait what|i missed that|i missed the question|i missed what you said|i (?:did not|didn t|could not|couldn t) (?:catch|hear)(?: that| you| the question| what you said| it)?|i can t hear(?: you| very well)?|the question again(?: please)?|the last question again|question again|sorry about that|de novo|novamente|mais uma vez|como|como disse|como foi|o que|o que foi|o que voce disse|o que voce falou|o que foi que voce disse|perdao|desculpa|desculpe|nao ouvi(?: direito| a pergunta| o que voce disse)?|nao escutei(?: direito| a pergunta)?|a pergunta de novo(?: por favor)?)$/u,
];

const unclearThing = "(?:the question|your question|that|this|it|the last question|what you mean|what you said|what you asked|what you are asking|what you re asking|the meaning|the point|your point|a pergunta|isso)";
const manner = "(?:in )?(?:(?:a )?(?:different|another|other|simpler|easier|simple|clearer|better) (?:way|words|manner|form|terms|english)|differently|more simply|simply|simpler|easier|clearer|in other words|in simpler words|in simple words)";
const notUnderstand = "(?:did not|didn t|do not|don t|dont|didnt|can t|cannot|can not|could not|couldn t|am not able to|m not able to|am not sure i|m not sure i)";

const rephrasePatterns = [
  new RegExp(`^(?:i )?(?:m |am )?(?:sorry )?(?:i )?${notUnderstand}(?: really| quite| fully| totally| completely| exactly| very well)* (?:understand|get|follow|got|understood)(?: ${unclearThing})?(?: very well| well| completely| sorry| properly| exactly| correctly)*$`, "u"),
  /^(?:i )?(?:m|am) not sure (?:what you mean|what you re asking|what you are asking|i understand(?: the question)?|i got it|i follow)$/u,
  new RegExp(`^${lead}(?:rephrase|reword|reformulate|simplify|clarify|paraphrase)(?: ${unclearThing})?(?: please| for me| a little| a bit| again| differently| in simpler words| in simple words| in other words)*$`, "u"),
  new RegExp(`^${lead}(?:say|ask|put|explain|tell|word|phrase|make)(?: me)?(?: ${unclearThing})?(?: it| that| the question)? ${manner}(?: please)?$`, "u"),
  new RegExp(`^${lead}explain(?: me)?(?: (?:${unclearThing}|better|more|again|a little more|a bit more|more clearly|more simply))*(?: please)?$`, "u"),
  /^(?:in other words|what do you mean(?: by (?:that|this|it|the question|your question|the last question|what you said|what you asked))?(?: exactly)?|what does (?:that|this|it) mean|what exactly do you mean|what exactly are you asking|what are you asking(?: me)?|what do you want to know|could you clarify|can you clarify|clarify please|i m (?:a little |a bit )?confused|i am (?:a little |a bit )?confused(?: about the question)?|i m lost|i got lost|you lost me|(?:can|could) you be (?:more specific|clearer)|(?:can|could) you give (?:me )?(?:more context|an example|me an example)|more context please|an example please)$/u,
  // Portuguese
  /^(?:eu )?(?:nao|n) (?:entendi|compreendi|consegui entender|peguei|saquei|ficou claro|entendo)(?: (?:a pergunta|isso|direito|bem|muito bem|nada|o que voce disse|o que voce quer dizer|o que voce quis dizer|desculpa|desculpe))*$/u,
  /^(?:voce )?(?:pode|poderia|podia|consegue) (?:explicar|reformular|perguntar|falar|dizer|simplificar|esclarecer)(?: (?:isso|a pergunta|melhor|de outra forma|de outra maneira|de outro jeito|de forma mais simples|mais simples|mais devagar|com outras palavras|em outras palavras|por favor|pra mim|para mim))*$/u,
  /^(?:como assim|o que voce quer dizer|o que voce quis dizer|o que quer dizer isso|o que isso quer dizer|o que significa isso|nao ficou claro|pode ser mais claro|seja mais claro|pode ser mais especifico|pode dar um exemplo|estou confus[oa]|fiquei confus[oa]|me perdi|voce me perdeu|explica melhor|explica de outro jeito|explica de novo|explica|reformula|reformule|pergunta de outro jeito|pergunta de outra forma|fala de outro jeito)$/u,
];

/** Words that make a "term" something other than a real term (the question itself, a pronoun, a degree adverb). */
const notATerm = /^(?:that|this|it|them|those|these|what|better|more|again|me|isso|aquilo|a pergunta|essa pergunta|the question|your question|the last question|the first question|a little|a bit|melhor|de novo|novamente)(?: |$)/u;
const term = "([a-z0-9][a-z0-9 .+#/-]{0,38})";

const definePatterns = [
  new RegExp(`^what (?:does|do|is|s) ${term} (?:mean|stand for|refer to)$`, "u"),
  new RegExp(`^what do you mean (?:by|with) ${term}$`, "u"),
  new RegExp(`^what (?:is|s) meant by ${term}$`, "u"),
  new RegExp(`^what (?:is|s) the (?:meaning|definition) of ${term}$`, "u"),
  new RegExp(`^${lead}(?:define|explain|describe|clarify|tell me)(?: what)? ${term}(?: is| means| mean)?$`, "u"),
  new RegExp(`^(?:i )?(?:do not|don t|dont) (?:know|understand|get) (?:what|the (?:word|term|meaning of)|the word|the term) ${term}(?: means| mean| is)?$`, "u"),
  new RegExp(`^(?:i )?(?:do not|don t|dont) (?:know|understand|get) ${term} (?:means|mean)$`, "u"),
  new RegExp(`^i (?:m|am) not familiar with ${term}$`, "u"),
  new RegExp(`^what (?:is|s|are) (?:an? |the )?${term}$`, "u"),
  new RegExp(`^o que (?:significa|quer dizer|e|eh) ${term}$`, "u"),
  new RegExp(`^o que (?:voce )?(?:quer dizer|quis dizer) com ${term}$`, "u"),
  new RegExp(`^(?:nao sei|nao conheco|nao entendi) (?:o que (?:e|significa|quer dizer)|a palavra|o termo) ${term}$`, "u"),
  new RegExp(`^(?:pode|poderia) (?:explicar|definir) (?:o que (?:e|significa) )?${term}$`, "u"),
];

/** Phrases that start or end an utterance without changing what it asks. */
const leadingFiller = /^(?:i m sorry|im sorry|i am sorry|sorry|um|uh|uhm|hmm|hm|ah|oh|eh|er|okay|ok|so|well|yes|yeah|hi|hello|hey|excuse me|thank you|thanks|sure|desculpa|desculpe|ola|oi|entao|bom|olha|ai|ne|e|mas|bem|ta|certo|tudo bem)\s+/u;
const trailingFiller = /\s+(?:please|thanks|thank you|sorry|ok|okay|por favor|obrigado|obrigada|valeu|desculpa|desculpe)$/u;

function stripFillers(text) {
  let core = text;
  for (let guard = 0; guard < 6; guard += 1) {
    const next = core.replace(leadingFiller, "").replace(trailingFiller, "");
    if (next === core || next === "") break;
    core = next;
  }
  return core;
}

function classifyCore(core) {
  if (!core) return null;
  if (rephrasePatterns.some((pattern) => pattern.test(core))) return "rephrase";
  if (repeatPatterns.some((pattern) => pattern.test(core))) return "repeat";
  for (const pattern of definePatterns) {
    const match = core.match(pattern);
    if (!match) continue;
    const subject = match[1];
    if (subject === undefined) return "define";
    if (!notATerm.test(subject) && subject.split(" ").length <= 4) return "define";
  }
  return null;
}

const priority = { repeat: 1, rephrase: 2, define: 3 };

/**
 * Returns "repeat" | "rephrase" | "define" when the whole utterance is a request to hear the question again, to
 * have it said another way, or to explain a word; otherwise null. A real answer (long, or with any other content)
 * returns null. When several sentences are requests, the strongest kind wins (define > rephrase > repeat).
 */
export function detectClarificationRequest(transcript) {
  if (typeof transcript !== "string") return null;
  const words = normalize(transcript).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > maxClarificationWords) return null;
  const sentences = transcript.split(/(?<=[.?!,;])\s+/u).map((sentence) => stripFillers(normalize(sentence))).filter(Boolean);
  const wholeKind = classifyCore(stripFillers(normalize(transcript)));
  if (wholeKind) return wholeKind;
  let best = null;
  for (const sentence of sentences) {
    const kind = classifyCore(sentence);
    // Anything that is not a clarification request makes the utterance an answer (fillers were already removed).
    if (!kind) return null;
    if (best === null || priority[kind] > priority[best]) best = kind;
  }
  return best;
}
