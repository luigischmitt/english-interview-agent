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
  return [
    { label: "Cargo", value: config.role.trim() || "Não selecionado" },
    { label: "Senioridade", value: seniorityLabels[config.seniority] ?? config.seniority },
    { label: "Foco", value: focusLabels[config.focus] ?? config.focus },
    { label: "Duração", value: `Até ${config.duration} min` },
    { label: "Como o entrevistador fala", value: config.playInterviewerAudio ? "Com áudio" : "Somente texto" },
    { label: "Legendas das perguntas", value: config.playInterviewerAudio ? (config.showQuestionCaptions ? "Ligadas" : "Desligadas") : "Sempre visíveis (somente texto)" },
    { label: "Minha fala", value: config.showCandidateTranscript ? "Transcrição visível" : "Transcrição oculta" },
    { label: "Microfone", value: config.autoCaptureVoice ? "Inicia após cada pergunta" : "Início manual" },
    { label: "Câmera", value: config.candidateCameraEnabled ? "Prévia local ligada" : "Desligada" },
  ];
}
