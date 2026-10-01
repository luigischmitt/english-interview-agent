// Browser (Web Speech API) fallback voice for the interviewer when network speech is slow or unavailable.

export const browserVoiceRate = 0.97;
export const browserVoicePitch = 1;
// How long to wait for the asynchronous `voiceschanged` event before using whatever voices exist.
export const voicesWaitMs = 500;

const preferredNames = [
  [/google us english/iu, 60],
  [/\b(samantha|ava|allison|zoe|evan|nathan|aaron|nicky)\b/iu, 45],
  [/natural|neural/iu, 40],
  [/premium|enhanced/iu, 35],
  [/\b(google|microsoft)\b/iu, 15],
];
// Robotic or novelty voices on desktop systems; only chosen when nothing else matches.
const avoidedNames = /\b(fred|albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|kathy|organ|princess|ralph|trinoids|whisper|zarvox|superstar|pipe organ|espeak)\b/iu;

function normalizeLang(lang) {
  return String(lang ?? "").replace("_", "-").toLowerCase();
}

function scoreVoice(voice) {
  const lang = normalizeLang(voice.lang);
  if (!lang.startsWith("en")) return -1;
  let score = lang === "en-us" ? 100 : 50;
  const name = String(voice.name ?? "");
  for (const [pattern, weight] of preferredNames) if (pattern.test(name)) score += weight;
  if (avoidedNames.test(name)) score -= 60;
  if (voice.localService === false && !/google|natural|neural/iu.test(name)) score -= 5;
  return score;
}

/** Picks the most natural-sounding English voice (en-US first, then en-*), or null when none is English. */
export function pickBrowserVoice(voices) {
  let best = null;
  let bestScore = -1;
  for (const voice of voices ?? []) {
    const score = scoreVoice(voice);
    if (score > bestScore) { best = voice; bestScore = score; }
  }
  return best;
}

function resolveSynthesis(options = {}) {
  return options.speechSynthesis ?? (typeof globalThis.speechSynthesis === "undefined" ? null : globalThis.speechSynthesis);
}

function resolveUtteranceFactory(options = {}) {
  if (options.makeUtterance) return options.makeUtterance;
  if (typeof globalThis.SpeechSynthesisUtterance === "function") return (text) => new globalThis.SpeechSynthesisUtterance(text);
  return null;
}

export function isBrowserVoiceAvailable(options = {}) {
  const synthesis = resolveSynthesis(options);
  return Boolean(synthesis && typeof synthesis.speak === "function" && resolveUtteranceFactory(options));
}

const voiceCache = new WeakMap();

/** Resolves the chosen voice (cached per speechSynthesis once found); waits at most `voicesWaitMs` for voices to load. */
export function loadBrowserVoice(options = {}) {
  const synthesis = resolveSynthesis(options);
  if (!synthesis) return Promise.resolve(null);
  const cached = voiceCache.get(synthesis);
  if (cached) return Promise.resolve(cached);
  const choose = () => {
    const voice = pickBrowserVoice(synthesis.getVoices?.() ?? []);
    if (voice) voiceCache.set(synthesis, voice);
    return voice;
  };
  const immediate = choose();
  if (immediate || typeof synthesis.addEventListener !== "function") return Promise.resolve(immediate);
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      synthesis.removeEventListener?.("voiceschanged", done);
      if (timer !== null) unschedule(timer);
      resolve(choose());
    };
    synthesis.addEventListener("voiceschanged", done);
    timer = schedule(done, voicesWaitMs);
  });
}

const wordCount = (text) => text.split(/\s+/u).filter(Boolean).length;

/**
 * Speaks sentences one utterance at a time (avoids Chrome stopping long utterances after ~15 s, and lets captions
 * advance per sentence). Resolves "completed" at the end (also when a sentence never reports `end`, after a bound of
 * words * 600 ms + 3 s), "cancelled" after cancel(), or "unavailable" when the engine rejects the speech.
 */
export function speakWithBrowserVoice(input, options = {}) {
  const sentences = (Array.isArray(input) ? input : [input]).map((sentence) => String(sentence).trim()).filter(Boolean);
  const synthesis = resolveSynthesis(options);
  const makeUtterance = resolveUtteranceFactory(options);
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
  let finished = false;
  let cancelled = false;
  let stuckTimer = null;
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });

  const finish = (result) => {
    if (finished) return;
    finished = true;
    if (stuckTimer !== null) unschedule(stuckTimer);
    stuckTimer = null;
    settle(result);
  };

  if (!synthesis || !makeUtterance || typeof synthesis.speak !== "function") {
    finish({ status: "unavailable" });
    return { promise, cancel() {} };
  }
  if (!sentences.length) {
    finish({ status: "completed" });
    return { promise, cancel() {} };
  }

  const speakSentence = (index, voice) => {
    if (finished) return;
    const sentence = sentences[index];
    const utterance = makeUtterance(sentence);
    utterance.lang = voice?.lang || "en-US";
    if (voice) utterance.voice = voice;
    utterance.rate = options.rate ?? browserVoiceRate;
    utterance.pitch = options.pitch ?? browserVoicePitch;
    utterance.onstart = () => {
      if (finished || utterance.started) return;
      utterance.started = true;
      if (index === 0) options.onStart?.();
      options.onSegment?.(sentence, index);
    };
    utterance.onend = () => {
      if (finished) return;
      if (stuckTimer !== null) unschedule(stuckTimer);
      stuckTimer = null;
      if (index + 1 < sentences.length) speakSentence(index + 1, voice);
      else { options.onEnd?.(); finish({ status: "completed" }); }
    };
    utterance.onerror = (event) => {
      if (finished) return;
      const reason = event?.error;
      if (cancelled || reason === "canceled" || reason === "interrupted") return;
      finish({ status: "unavailable" });
    };
    // A sentence that never ends (paused/stuck engine) must not freeze the interview.
    stuckTimer = schedule(() => {
      if (finished) return;
      try { synthesis.cancel?.(); } catch { /* Best effort. */ }
      options.onEnd?.();
      finish({ status: "completed" });
    }, wordCount(sentence) * 600 + 3_000);
    try {
      synthesis.speak(utterance);
    } catch {
      finish({ status: "unavailable" });
    }
  };

  void (options.voice !== undefined ? Promise.resolve(options.voice) : loadBrowserVoice(options)).then((voice) => {
    if (!finished && !cancelled) speakSentence(0, voice);
  });

  return {
    promise,
    cancel() {
      if (finished) return;
      cancelled = true;
      try { synthesis.cancel?.(); } catch { /* Best effort. */ }
      finish({ status: "cancelled" });
    },
  };
}
