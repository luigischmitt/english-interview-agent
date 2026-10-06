export const VOICE_POLL_INTERVAL_MS = 3_000;
export const VOICE_POLL_MAX_MS = 120_000;

const knownStates = new Set(["ready", "warming", "unavailable"]);

export const voiceReadinessCopy = {
  warming: "Ligando a voz do entrevistador… Isso pode levar alguns segundos.",
  ready: "Voz do entrevistador ligada e pronta.",
  unavailable: "Não foi possível ligar a voz do entrevistador agora.",
};

/** Text-only interviews do not depend on the speech provider. */
export function voiceBlocksInterviewStart(playInterviewerAudio, state) {
  return Boolean(playInterviewerAudio) && state !== "ready";
}

/** GET <speech endpoint>/warmup-status; resolves to a known state or null (never rejects). */
export async function fetchVoiceStatus(endpoint, fetcher, signal) {
  try {
    const response = await fetcher(`${endpoint}/warmup-status`, { method: "GET", ...(signal ? { signal } : {}) });
    if (!response?.ok) return null;
    const body = await response.json();
    return knownStates.has(body?.voice) ? body.voice : null;
  } catch {
    return null;
  }
}

/**
 * Polls until the voice is ready, then stops. Polls run one at a time (the next is scheduled after
 * the previous settles). After maxMs without "ready" the state settles on "unavailable". A null
 * result (network or auth hiccup) keeps the previous state.
 */
export function startVoiceReadinessPolling({
  fetchStatus,
  onState,
  intervalMs = VOICE_POLL_INTERVAL_MS,
  maxMs = VOICE_POLL_MAX_MS,
  now = Date.now,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (id) => clearTimeout(id),
}) {
  const startedAt = now();
  let stopped = false;
  let timer;
  let current = "warming";
  const emit = (state) => {
    if (state === current) return;
    current = state;
    onState(state);
  };
  onState(current);

  const tick = async () => {
    const result = await fetchStatus();
    if (stopped) return;
    if (result === "ready") { emit("ready"); stopped = true; return; }
    if (result) emit(result);
    if (now() - startedAt >= maxMs) { emit("unavailable"); stopped = true; return; }
    timer = setTimer(() => void tick(), intervalMs);
  };
  void tick();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimer(timer);
  };
}
