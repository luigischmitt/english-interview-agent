export type SpeechPlaybackResult =
  | { status: "completed" }
  | { status: "unavailable"; message: string }
  | { status: "cancelled" };

export type SpeechPlayback = {
  promise: Promise<SpeechPlaybackResult>;
  cancel: () => void;
};

type SpeechPlaybackOptions = {
  endpoint: string;
  timeoutMs?: number;
};

export function synthesizeInterviewerQuestion(text: string, options: SpeechPlaybackOptions): SpeechPlayback {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  let audio: HTMLAudioElement | null = null;
  let objectUrl: string | null = null;
  let cancelled = false;
  let timedOut = false;
  let timeoutId: number | null = null;
  let resolvePlayback: (() => void) | null = null;

  const cleanup = () => {
    audio?.pause();
    audio = null;
    resolvePlayback = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };

  const cancel = () => {
    cancelled = true;
    controller.abort();
    resolvePlayback?.();
    cleanup();
  };

  const promise = (async (): Promise<SpeechPlaybackResult> => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        return { status: "unavailable", message: data?.error?.message ?? "O áudio não está disponível agora. Você pode continuar sem ele." };
      }

      objectUrl = URL.createObjectURL(await response.blob());
      audio = new Audio(objectUrl);
      await audio.play();
      if (cancelled) return { status: "cancelled" };
      await new Promise<void>((resolve, reject) => {
        resolvePlayback = resolve;
        audio?.addEventListener("ended", () => resolve(), { once: true });
        audio?.addEventListener("error", () => reject(new Error("Audio playback failed.")), { once: true });
      });
      if (cancelled) return { status: "cancelled" };
      return { status: "completed" };
    } catch {
      if (cancelled) return { status: "cancelled" };
      return { status: "unavailable", message: timedOut ? "O áudio demorou demais para responder. Você pode continuar sem ele." : "O áudio não está disponível agora. Você pode continuar sem ele." };
    } finally {
      cleanup();
    }
  })();

  return { promise, cancel };
}
