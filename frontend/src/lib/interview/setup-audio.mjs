import { voiceDisplayName } from "./voice-picker.mjs";
import { resolveInterviewerVoice } from "./voices.mjs";
import { isResumePractice, RESUME_PRACTICE_LABEL } from "./resume-neutral.mjs";

export const defaultInterviewRoomPreferences = {
  playInterviewerAudio: true,
  showQuestionCaptions: true,
  candidateCameraEnabled: false,
};

export function getInterviewerAudioMode(config) {
  return config.playInterviewerAudio ? "audio" : "text";
}

export function withInterviewerAudioMode(config, mode) {
  return { ...config, playInterviewerAudio: mode === "audio" };
}

export function getInterviewSetupSummary(config, seniorityLabels, focusLabels) {
  // Resume practice has no target job: the inferred role, seniority and focus are not shown.
  const resume = isResumePractice(config);
  return [
    { label: "Cargo", value: resume ? RESUME_PRACTICE_LABEL : config.role.trim() || "Não selecionado" },
    ...(resume ? [] : [
      { label: "Senioridade", value: seniorityLabels[config.seniority] ?? config.seniority },
      { label: "Foco", value: focusLabels[config.focus] ?? config.focus },
    ]),
    { label: "Duração", value: `Até ${config.duration} min` },
    { label: "Como o entrevistador fala", value: config.playInterviewerAudio ? "Com áudio" : "Somente texto" },
    // The voice only matters when the interviewer speaks.
    ...(config.playInterviewerAudio ? [{ label: "Voz", value: voiceDisplayName(resolveInterviewerVoice(config.voice)) }] : []),
    { label: "Legendas das perguntas", value: config.playInterviewerAudio ? (config.showQuestionCaptions ? "Ligadas" : "Desligadas") : "Sempre visíveis (somente texto)" },
    { label: "Microfone", value: config.autoCaptureVoice ? "Inicia após cada pergunta" : "Início manual" },
    { label: "Câmera", value: config.candidateCameraEnabled ? "Prévia local ligada" : "Desligada" },
  ];
}
