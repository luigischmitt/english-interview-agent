/** PT-BR explanations shown next to each report metric (ENG-113). Plain, respectful, and explicit about limits. */
export const azureMetricCopy = {
  accuracy: {
    label: "Precisão",
    help: "Compara os sons à pronúncia esperada pelo Azure em en-US. É um sinal experimental: não mede inteligibilidade, nível de inglês ou qualidade do sotaque.",
  },
  fluency: {
    label: "Ritmo da fala",
    help: "É um sinal do ritmo dentro dos trechos avaliados, como pausas e interrupções entre palavras — não uma nota de fluência geral. Pausas entre trechos e o tempo para começar a responder não entram no cálculo.",
  },
  prosody: {
    label: "Prosódia",
    help: "Estima entonação e acento segundo padrões en-US. É muito sensível a áudio curto ou ruidoso e não indica que um sotaque brasileiro seja um erro.",
  },
};

export const azureReportIntro = "Médias experimentais do Azure por resposta, ponderadas pelo tempo avaliado e calibradas para inglês en-US. Um erro de transcrição pode alterar o resultado. Esses números não medem seu nível geral, sua inteligibilidade ou a qualidade do seu sotaque.";

export const azureReliabilityCopy = {
  insufficient: "Áudio avaliado curto demais para mostrar um valor confiável.",
  limited: "Estimativa baseada em pouco áudio; use apenas como indício.",
};

export const clarityHelp = "Resumo qualitativo do quanto suas respostas foram fáceis de entender, com base apenas no texto transcrito. Não avalia pronúncia nem é um nível de inglês.";
export const technicalContentHelp = "Avalia o que a resposta disse sobre o tema, separado da forma como foi dita em inglês. Um erro de gramática não conta como falha técnica.";
export const englishPatternsHelp = "Trechos literais das suas respostas com padrões comuns de falantes de português. Se o trecho pode ter sido um erro de transcrição, ele não é apontado.";
export const coverageHelp = "Quantas respostas tiveram sinais de voz calculados. Respostas muito curtas ou sem avaliação disponível ficam fora das médias.";

/** Label for what `sampleCount` counts: answers, not audio segments. */
export function answerCountLabel(count) {
  return `${count} ${count === 1 ? "resposta avaliada" : "respostas avaliadas"}`;
}
