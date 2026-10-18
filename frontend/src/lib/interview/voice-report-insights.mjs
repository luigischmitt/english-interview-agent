import { azureMetricReliability } from "./report-metrics.mjs";
import { voiceScoreLevel } from "./voice-insights.mjs";


const metricCopy = {
  accuracy: {
    good: "Nesta entrevista, os sons ficaram próximos do esperado; continue praticando palavras-chave dentro de frases curtas.",
    attention: "Nesta entrevista, alguns sons podem ter perdido clareza; escolha uma palavra por vez e repita-a em frases curtas.",
    focus: "Nesta entrevista, a pronúncia pode ter dificultado alguns trechos; diminua o ritmo e treine palavras-chave em frases curtas.",
  },
  fluency: {
    good: "Nesta entrevista, o ritmo entre palavras e pausas sustentou bem suas respostas; mantenha pausas curtas entre as ideias.",
    attention: "Nesta entrevista, o ritmo oscilou em alguns trechos; organize a resposta em blocos curtos e pause entre as ideias.",
    focus: "Nesta entrevista, pausas e quebras entre palavras podem ter interrompido suas respostas; treine uma frase completa por vez, com pausas entre as ideias.",
  },
  prosody: {
    good: "Nesta entrevista, a entonação e o acento das palavras ajudaram a dar forma às ideias; continue destacando a palavra principal de cada frase.",
    attention: "Nesta entrevista, a entonação ou o acento das palavras variou em alguns trechos; destaque a palavra principal de cada ideia.",
    focus: "Nesta entrevista, a entonação ou o acento das palavras pode ter deixado alguns trechos menos expressivos; treine blocos curtos e destaque uma palavra-chave em cada um.",
  },
};

const finite = (value) => Number.isFinite(value);

export function voiceMetricInterpretation(dimension, metric) {
  const reliability = azureMetricReliability(metric);
  if (!finite(metric?.mean) || reliability === "insufficient") {
    return "Ainda não há áudio avaliado suficiente para indicar um próximo passo neste sinal.";
  }
  const interpretation = metricCopy[dimension]?.[voiceScoreLevel(metric.mean)];
  return interpretation ?? "Ainda não há áudio avaliado suficiente para indicar um próximo passo neste sinal.";
}

export function voiceDeliveryInterpretation(answers) {
  const delivery = (Array.isArray(answers) ? answers : []).map((answer) => answer?.delivery).filter((item) => item && typeof item === "object");
  const speeds = delivery.map((item) => item.wordsPerMinute).filter(finite);
  if (!delivery.length || !speeds.length) return null;

  const wordsPerMinute = Math.round(speeds.reduce((sum, value) => sum + value, 0) / speeds.length);
  const longestPauseMs = Math.max(0, ...delivery.map((item) => finite(item.longestPauseMs) ? item.longestPauseMs : 0));
  const pauseCount = delivery.reduce((sum, item) => sum + (finite(item.pauseCount) ? item.pauseCount : 0), 0);
  const fillers = [...new Set(delivery.flatMap((item) => Array.isArray(item.fillers)
    ? item.fillers.filter((word) => typeof word === "string" && word.trim()).map((word) => word.trim())
    : item.fillers && typeof item.fillers === "object"
      ? Object.entries(item.fillers).filter(([word, count]) => typeof word === "string" && word.trim() && finite(count) && count > 0).map(([word]) => word.trim())
      : []))].slice(0, 3);
  const insights = [];

  if (wordsPerMinute > 165) insights.push({ key: "O ritmo ficou acelerado; diminua um pouco e faça uma pausa breve entre as ideias." });
  if (wordsPerMinute < 110) insights.push({ key: "O ritmo ficou mais pausado; conecte duas frases curtas antes de fazer uma pausa." });
  if (longestPauseMs >= 2_000) insights.push({ key: "Algumas pausas podem interromper a linha de raciocínio; marque a pausa antes da próxima ideia." });
  if (fillers.length) insights.push({ key: "Você usou {fillers} como hesitação; troque-os por uma pausa curta enquanto organiza a próxima ideia.", values: { fillers: fillers.map((word) => `“${word}”`).join(", ") } });

  if (!insights.length) insights.push({ key: "O ritmo ficou estável nesta entrevista. Continue fazendo pausas breves entre as ideias." });

  return {
    wordsPerMinute,
    pauseCount,
    longestPauseMs,
    fillerCount: delivery.reduce((sum, item) => sum + (finite(item.fillerCount) ? item.fillerCount : 0), 0),
    insights,
    insight: insights.map((item) => item.key).join(" "),
  };
}
