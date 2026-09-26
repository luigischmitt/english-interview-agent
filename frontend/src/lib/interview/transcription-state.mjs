const failureMessages = {
  NO_SPEECH_RECOGNIZED: "Não conseguimos reconhecer sua fala. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  UPSTREAM_RATE_LIMITED: "O serviço de transcrição está ocupado. Aguarde um instante e tente novamente, pule a pergunta ou encerre a prática.",
  UPSTREAM_UNAVAILABLE: "O serviço de transcrição está indisponível agora. Tente novamente, pule a pergunta ou encerre a prática.",
  UPSTREAM_REJECTED: "O áudio não pôde ser processado. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  NO_SPEECH_DETECTED: "Não detectamos fala nessa gravação. Confira o microfone e tente novamente, pule a pergunta ou encerre a prática.",
  STREAM_TOO_SHORT: "Não recebemos fala suficiente para transcrever. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  SPEECH_TOO_SHORT: "A resposta ficou curta demais para transcrever. Tente novamente, pule a pergunta ou encerre a prática.",
  STREAM_SIZE_LIMIT: "A resposta passou do limite de áudio. Tente uma resposta mais curta, pule a pergunta ou encerre a prática.",
  STREAM_DURATION_LIMIT: "A resposta passou do tempo máximo de gravação. Tente uma resposta mais curta, pule a pergunta ou encerre a prática.",
  STREAM_TIMEOUT: "A captura de áudio expirou. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  STREAM_NOT_FOUND: "A conexão de áudio expirou. Tente gravar novamente, pule a pergunta ou encerre a prática.",
  STREAM_CAPACITY_REACHED: "A sala está processando o máximo de gravações agora. Aguarde um instante e tente novamente, pule a pergunta ou encerre a prática.",
  TRANSCRIPTION_CAPACITY_REACHED: "Há muitas respostas sendo processadas agora. Aguarde um instante e tente novamente, pule a pergunta ou encerre a prática.",
  TRANSCRIPTION_NOT_CONFIGURED: "A transcrição não está disponível agora. Tente novamente, pule a pergunta ou encerre a prática.",
  UNSUPPORTED_PCM_PROTOCOL: "O formato de áudio deste navegador não é compatível. Tente em outro navegador, pule a pergunta ou encerre a prática.",
};

export function transcriptionFailureMessage(code) {
  return typeof code === "string" && Object.hasOwn(failureMessages, code)
    ? failureMessages[code]
    : "A transcrição não foi concluída. Tente gravar novamente, pule a pergunta ou encerre a prática.";
}

export function finalVoiceTranscription(message) {
  const transcript = typeof message?.transcript === "string" ? message.transcript.trim() : "";
  const provider = ["azure", "whisper-large-v3", "whisper-large-v3-turbo"].includes(message?.provider)
    ? message.provider
    : "whisper-large-v3-turbo";
  if (message?.status === "complete" && transcript) {
    return {
      status: "available",
      value: {
        provider,
        transcript,
      },
    };
  }

  return { status: "failed", message: transcriptionFailureMessage(message?.code) };
}
