import { useCallback, useEffect, useState } from "react";

import { toSelectableInputs, type SelectableInput } from "@/lib/interview/mic-device.mjs";

/**
 * Audio inputs the user can pick from. Labels are empty until the page holds microphone permission, so call
 * `refresh` after a successful getUserMedia; the list also follows plug/unplug (`devicechange`).
 */
export function useAudioInputs(enabled: boolean): { inputs: SelectableInput[]; refresh: () => Promise<void> } {
  const [inputs, setInputs] = useState<SelectableInput[]>([]);

  const refresh = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      setInputs(toSelectableInputs(await navigator.mediaDevices.enumerateDevices()));
    } catch { /* Keeps the previous list. */ }
  }, []);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => { void refresh(); };
    onChange();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [enabled, refresh]);

  return { inputs, refresh };
}
