// iOS/WebKit only lets an HTMLMediaElement play() programmatically (after async fetches, with no user gesture on
// the stack) if THAT element was started from a user gesture before. A fresh `new Audio()` per chunk is never
// blessed, so playback is rejected with NotAllowedError. We keep a small module-level pool of elements, unlock
// them on the first gesture (the document survives client-side navigation to /interview) and reuse them by
// swapping `src`.

import { createWebAudioTrack, peekPlaybackContext, shouldUseWebAudio, unlockPlaybackContext } from "./web-audio-playback.mjs";

// ~0.1 s of silent 8-bit mono WAV.
export const SILENT_AUDIO_URI = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
// One element plays while the next one buffers.
export const AUDIO_POOL_SIZE = 2;

export function isAutoplayBlockedError(error) {
  return error?.name === "NotAllowedError";
}

export function createAudioPool({ create = () => new Audio(), size = AUDIO_POOL_SIZE } = {}) {
  const free = [];
  const owned = new Set();
  let unlocked = false;

  const add = () => {
    const audio = create();
    try { audio.preload = "auto"; } catch { /* Best effort. */ }
    owned.add(audio);
    free.push(audio);
    return audio;
  };

  return {
    /** Takes a pooled (blessed) element and points it at `url`. */
    acquire(url) {
      const audio = free.pop() ?? add();
      audio.src = url;
      return audio;
    },
    /** Returns an element taken with `acquire`; anything else is ignored. */
    release(audio) {
      if (owned.has(audio) && !free.includes(audio)) free.push(audio);
    },
    /**
     * Must run synchronously inside a user gesture: starts every free element on a silent clip so WebKit marks it as
     * user-activated, then stops it. Runs once; a failure leaves it retryable.
     */
    unlock(force = false) {
      if (unlocked && !force) return false;
      while (owned.size < size) add();
      unlocked = true;
      for (const audio of [...free]) {
        try {
          audio.src = SILENT_AUDIO_URI;
          const settle = () => {
            if (audio.src !== SILENT_AUDIO_URI) return;
            audio.pause();
            audio.removeAttribute?.("src");
            audio.load?.();
          };
          Promise.resolve(audio.play()).then(settle, () => { unlocked = false; });
        } catch {
          unlocked = false;
        }
      }
      return true;
    },
    get isUnlocked() { return unlocked; },
  };
}

let sharedPool = null;
const pool = () => (sharedPool ??= createAudioPool());

/** Test hook: forgets the shared pool and its gesture listeners. */
export function resetSharedAudioPool() {
  sharedPool = null;
  removeGestureListeners?.();
}

export const acquireSharedAudio = (url) => pool().acquire(url);
export const releaseSharedAudio = (audio) => sharedPool?.release(audio);
let unlockObserver = null;
/** Optional content-free observer, called after each unlock attempt with `{ pooled, audioContextState }`. */
export const setAudioUnlockObserver = (observer) => { unlockObserver = observer; };

export const unlockSharedAudio = (force = false) => {
  // iOS plays the interviewer through Web Audio: its context must be resumed inside this same gesture.
  const audioContextState = shouldUseWebAudio() ? unlockPlaybackContext() : undefined;
  const pooled = typeof Audio === "undefined" ? false : pool().unlock(force);
  try { unlockObserver?.({ pooled, ...(audioContextState ? { audioContextState } : {}) }); } catch { /* Diagnostics only. */ }
  return pooled;
};

/** The interviewer's playback surface: a Web Audio track on iOS, otherwise a pooled (unlocked) HTMLAudioElement. */
export const acquireInterviewerAudio = (url) => (shouldUseWebAudio() ? createWebAudioTrack(url) : acquireSharedAudio(url));
export const releaseInterviewerAudio = (audio) => {
  if (typeof audio?.dispose === "function") audio.dispose();
  else releaseSharedAudio(audio);
};
/** True when the interviewer plays through Web Audio on this device. */
export const isWebAudioPlayback = () => shouldUseWebAudio();

const gestureEvents = ["pointerdown", "touchend", "click", "keydown"];
let removeGestureListeners = null;

/** Unlocks the shared audio elements on the first user gesture on `target`; idempotent. Returns a remover. */
export function installAudioUnlockOnFirstGesture(target = typeof document === "undefined" ? null : document) {
  if (!target || removeGestureListeners) return () => {};
  const remove = () => {
    for (const type of gestureEvents) target.removeEventListener(type, onGesture, true);
    if (removeGestureListeners === remove) removeGestureListeners = null;
  };
  const onGesture = () => {
    unlockSharedAudio();
    // Keep listening until WebKit actually accepted the unlock (a rejected silent play re-arms `unlock`).
    const contextReady = !shouldUseWebAudio() || peekPlaybackContext()?.state === "running";
    if (sharedPool?.isUnlocked && contextReady) remove();
  };
  for (const type of gestureEvents) target.addEventListener(type, onGesture, true);
  removeGestureListeners = remove;
  return remove;
}
