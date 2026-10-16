/** Match each per-answer finding to its answer, with legacy flat-list fallback. */
export function findingsForAnswer(result, sequenceNumber) {
  const turn = result.turns?.find((item) => item.sequenceNumber === sequenceNumber);
  return {
    strengths: turn?.technicalStrengths ?? result.technicalContent.strengths.filter((item) => item.sequenceNumber === sequenceNumber),
    gaps: turn?.technicalGaps ?? result.technicalContent.gaps.filter((item) => item.sequenceNumber === sequenceNumber),
    patterns: turn?.englishPatterns ?? result.englishCommunication.patterns.filter((item) => item.sequenceNumber === sequenceNumber),
  };
}

export function summarizeDelivery(delivery) {
  if (!delivery) return null;
  const pauses = delivery.pauseCount ?? 0;
  const hasLongPause = delivery.longestPauseMs >= 1_000;
  const hints = [];
  if (delivery.wordsPerMinute < 95) hints.push("O ritmo ficou mais pausado do que o habitual.");
  if (delivery.wordsPerMinute > 170) hints.push("O ritmo ficou acelerado; pequenas pausas podem ajudar.");
  if (pauses > 2 && hasLongPause) hints.push("Algumas pausas longas podem interromper a linha de raciocínio.");
  if (delivery.fillerCount > 4) hints.push("Vale observar se as hesitações se repetem.");
  return { wordsPerMinute: Number.isFinite(delivery.wordsPerMinute) ? Math.round(delivery.wordsPerMinute) : null, pauseCount: pauses, longestPauseMs: delivery.longestPauseMs ?? 0, fillerCount: delivery.fillerCount ?? 0, hint: hints[0] ?? null };
}

export function phonemeHint(phoneme) {
  const value = String(phoneme ?? "").toLowerCase();
  if (/θ|ð|th/.test(value)) return "Som de th: língua levemente entre os dentes.";
  if (/ɹ|r|h/.test(value)) return "Observe o som inicial de r ou h em inglês.";
  if (/ɪ|iː|i:/.test(value)) return "Diferencie o i curto do i longo em inglês.";
  if (/ə|schwa/.test(value)) return "A vogal reduzida costuma soar como um “â” bem curto.";
  if (/ed|t$|d$/.test(value)) return "Pronuncie a terminação final com clareza.";
  if (/æ|ʌ|ɒ|ɑ/.test(value)) return "Ajuste a vogal curta sem acrescentar uma vogal no final.";
  if (/final|consonant/.test(value)) return "Mantenha a consoante final audível.";
  return null;
}
