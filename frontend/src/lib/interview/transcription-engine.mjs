export const defaultTranscriptionEngine = "whisper";

export const transcriptionEngineOptions = [
  { value: "whisper", label: "Whisper (padrão)", helper: "Legenda da sua fala aparece por trecho, a cada pausa." },
  { value: "ink-2", label: "Cartesia Ink-2", helper: "Legenda palavra a palavra; usa créditos da Cartesia (cai para o Whisper se acabarem)." },
];

/** Old or malformed configs (no field, unknown value) default to Whisper. */
export function resolveTranscriptionEngine(config) {
  const value = config?.transcriptionEngine;
  return transcriptionEngineOptions.some((option) => option.value === value) ? value : defaultTranscriptionEngine;
}
