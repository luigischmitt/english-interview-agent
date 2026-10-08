"use client";


import { t } from "@/lib/locale";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Pause, Play } from "lucide-react";
import { groupVoicesByGender, voiceDisplayName, voiceSamplePath, voiceSummary } from "@/lib/interview/voice-picker.mjs";

const groups = groupVoicesByGender();

/**
 * Interviewer voice choice: a compact trigger with the current voice that expands into the full list. Each row is a
 * radio (keyboard: arrows) plus a play/pause button for the static sample in /public/voices (no API call). One sample
 * plays at a time and it stops on selection change, collapse and unmount.
 */
export function VoicePicker({
  value,
  onChange,
  onSampleStart,
  disabled = false,
  disabledNote,
}: {
  value: string;
  onChange: (voice: string) => void;
  /** Called when a sample starts, so the caller can silence other audio (e.g. the "Testar áudio" phrase). */
  onSampleStart?: () => void;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopSample = () => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlayingId(null);
  };

  // Unmount (or the section turning off) must never leave a sample playing.
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    // The "pause" listener below resets the playing state.
    if (disabled) audioRef.current?.pause();
  }, [disabled]);

  const toggleSample = (id: string) => {
    if (playingId === id) { stopSample(); return; }
    stopSample();
    onSampleStart?.();
    const audio = new Audio(voiceSamplePath(id));
    audioRef.current = audio;
    const finish = () => { if (audioRef.current === audio) { audioRef.current = null; setPlayingId(null); } };
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    audio.addEventListener("pause", finish);
    setPlayingId(id);
    audio.play().catch(finish);
  };

  const choose = (id: string) => {
    stopSample();
    onChange(id);
  };

  const toggleOpen = () => {
    if (open) stopSample();
    setOpen((current) => !current);
  };

  const listId = `${uid}-list`;
  const labelId = `${uid}-label`;
  const noteId = `${uid}-note`;

  return (
    <div className="vp">
      <span id={labelId} className="ds-label block">{t("Voz do entrevistador")}</span>
      <button
        type="button"
        className="vp-trigger mt-2"
        aria-expanded={open && !disabled}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${uid}-current`}
        aria-describedby={disabled && disabledNote ? noteId : undefined}
        disabled={disabled}
        onClick={toggleOpen}
      >
        <span id={`${uid}-current`} className="min-w-0 flex-1 truncate text-left text-[15px] font-medium">{voiceSummary(value)}</span>
        <span className="vp-trigger-action" aria-hidden="true">{open && !disabled ? "Fechar" : "Alterar"}</span>
        <ChevronDown className="ds-chevron size-4 shrink-0 text-text-2" style={{ transform: open && !disabled ? "rotate(180deg)" : undefined }} aria-hidden="true" />
      </button>
      {disabled && disabledNote && <p id={noteId} className="ds-small mt-2">{disabledNote}</p>}

      <div id={listId} className="ds-reveal" data-open={open && !disabled} inert={!open || disabled}>
        <div>
          <fieldset className="vp-list">
            <legend className="sr-only">{t("Voz do entrevistador")}</legend>
            <p className="ds-small">{t("Toque em ▶ para ouvir a mesma frase em cada voz e selecione a que preferir.")}</p>
            {groups.map((group) => (
              <div key={group.gender} role="group" aria-labelledby={`${uid}-${group.gender}`} className="mt-4">
                <h4 id={`${uid}-${group.gender}`} className="vp-group-title">{group.label}</h4>
                <div className="vp-grid">
                  {group.voices.map((voice) => {
                    const playing = playingId === voice.id;
                    return (
                      <div key={voice.id} className="vp-row" data-playing={playing}>
                        <label className="vp-pick">
                          <input type="radio" name={`${uid}-voice`} value={voice.id} className="ds-radio vp-radio" checked={value === voice.id} onChange={() => choose(voice.id)} />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold leading-5">
                              {voice.name}
                              {voice.isDefault && <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] text-green-deep">{t("Padrão")}</span>}
                            </span>
                            <span className="ds-small block leading-5">{t(voice.accent === "UK" ? "britânica" : "americana")}</span>
                          </span>
                        </label>
                        <button
                          type="button"
                          className="vp-play"
                          aria-pressed={playing}
                          aria-label={`${playing ? "Pausar" : "Ouvir"} amostra da voz ${voiceDisplayName(voice.id)}`}
                          onClick={() => toggleSample(voice.id)}
                        >
                          {playing ? <Pause className="size-4" fill="currentColor" aria-hidden="true" /> : <Play className="size-4" fill="currentColor" aria-hidden="true" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
