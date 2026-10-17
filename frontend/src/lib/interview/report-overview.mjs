export function groupPatternsByType(patterns = []) {
  return patterns.reduce((groups, pattern) => {
    const group = groups.find((item) => item.type === pattern.type);
    if (group) group.items.push(pattern);
    else groups.push({ type: pattern.type, items: [pattern] });
    return groups;
  }, []);
}

export function deriveOverviewTiles(result, answers = []) {
  const overview = result?.overview ?? {};
  const strengths = result?.technicalContent?.strengths?.length ?? 0;
  const gaps = result?.technicalContent?.gaps?.length ?? 0;
  const deliveries = answers.map((answer) => answer.delivery).filter(Boolean);
  const avg = (key) => deliveries.length ? deliveries.reduce((sum, item) => sum + (item[key] ?? 0), 0) / deliveries.length : null;
  const wpm = avg("wordsPerMinute");
  const hesitations = deliveries.reduce((sum, item) => sum + (item.fillerCount ?? 0), 0);
  const voice = wpm === null && !answers.some((answer) => answer.scores) ? null : wpm !== null && wpm >= 100 && wpm <= 160 && hesitations <= 4 ? "Ritmo calmo, poucas hesitações" : wpm !== null && wpm > 160 ? "Ritmo acelerado; pausas podem ajudar" : "Ritmo e hesitações observados na sessão";
  return [
    { id: "technical", title: "Conteúdo técnico", text: overview.technical || `${strengths} ${strengths === 1 ? "ponto forte" : "pontos fortes"}, ${gaps} ${gaps === 1 ? "lacuna" : "lacunas"}` },
    { id: "english", title: "Inglês", text: overview.english || `${result?.englishCommunication?.patterns?.length ?? 0} padrões de inglês observados` },
    { id: "voice", title: "Voz", text: voice },
  ];
}
