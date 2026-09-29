/** @typedef {{ candidates: number; accepted: number; rejected: number }} EvidenceCounts */

/**
 * @param {EvidenceCounts | undefined} counts
 * @returns {string}
 */
export function emptyReportEvidenceMessage(counts) {
  if (!counts) return "Nenhum item foi incluído nesta seção. O relatório anterior não registrava se isso ocorreu por ausência de um achado seguro ou por validação das citações.";
  if (counts.candidates === 0) return "Nenhum item específico foi apontado com segurança nesta seção.";
  return "Os itens recebidos nesta seção foram omitidos porque não passaram pela validação das evidências.";
}

/**
 * @param {string} status
 * @param {EvidenceCounts | undefined} counts
 * @returns {string}
 */
export function emptyEnglishEvidenceMessage(status, counts) {
  if (status === "NO_PATTERN_FOUND") return "Nenhum padrão específico de inglês foi apontado com segurança nas respostas. Isso não é uma avaliação do seu nível geral de inglês.";
  if (status === "CANDIDATES_REJECTED") return "Os exemplos recebidos não passaram pela validação das evidências e foram omitidos. Por isso, não há um padrão específico para comentar.";
  if (counts) return emptyReportEvidenceMessage(counts);
  return "Nenhum padrão específico foi incluído neste relatório. Em relatórios anteriores, não há dados para distinguir ausência de um achado seguro de exemplos omitidos na validação.";
}

/**
 * Return a note only when at least one item was omitted alongside included items.
 * @param {EvidenceCounts | undefined} counts
 * @returns {string | null}
 */
export function partialEvidenceReviewNote(counts) {
  if (!counts || counts.accepted === 0 || counts.rejected === 0) return null;
  const receivedLabel = counts.candidates === 1 ? "item recebido" : "itens recebidos";
  const includedLabel = counts.accepted === 1 ? "incluído" : "incluídos";
  const omittedLabel = counts.rejected === 1 ? "omitido" : "omitidos";
  return `Revisão automática: ${counts.candidates} ${receivedLabel}, ${counts.accepted} ${includedLabel} e ${counts.rejected} ${omittedLabel} após validação.`;
}
