import assert from "node:assert/strict";
import test from "node:test";
import { emptyEnglishEvidenceMessage, emptyReportEvidenceMessage, partialEvidenceReviewNote } from "../src/lib/interview/report-evidence-copy.mjs";

test("new English report with no candidates says no safe pattern was found", () => {
  const message = emptyEnglishEvidenceMessage("NO_PATTERN_FOUND", { candidates: 0, accepted: 0, rejected: 0 });
  assert.match(message, /Nenhum padrão específico de inglês foi apontado com segurança/);
  assert.match(message, /não é uma avaliação do seu nível geral/);
  assert.doesNotMatch(message, /insuficiente/i);
});

test("English report with all candidates rejected says they were omitted after validation", () => {
  const message = emptyEnglishEvidenceMessage("CANDIDATES_REJECTED", { candidates: 2, accepted: 0, rejected: 2 });
  assert.match(message, /não passaram pela validação das evidências e foram omitidos/);
  assert.doesNotMatch(message, /sugestões recebidas/i);
});

test("partially rejected category shows an aggregate note only for omitted items", () => {
  assert.equal(partialEvidenceReviewNote({ candidates: 3, accepted: 2, rejected: 1 }), "Revisão automática: 3 itens recebidos, 2 incluídos e 1 omitido após validação.");
  assert.equal(partialEvidenceReviewNote({ candidates: 2, accepted: 2, rejected: 0 }), null);
  assert.equal(partialEvidenceReviewNote({ candidates: 1, accepted: 0, rejected: 1 }), null);
  assert.equal(partialEvidenceReviewNote(undefined), null);
});

test("legacy INSUFFICIENT report without metadata uses neutral compatibility copy", () => {
  const message = emptyEnglishEvidenceMessage("INSUFFICIENT", undefined);
  assert.match(message, /relatórios anteriores/);
  assert.match(message, /não há dados para distinguir/);
  assert.doesNotMatch(message, /Evidência insuficiente/);
});

test("technical empty sections avoid implying that strengths, gaps, or priorities were suggestions", () => {
  const allRejected = emptyReportEvidenceMessage({ candidates: 1, accepted: 0, rejected: 1 });
  assert.match(allRejected, /itens recebidos nesta seção foram omitidos/);
  assert.doesNotMatch(allRejected, /sugestões/);
  assert.match(emptyReportEvidenceMessage(undefined), /relatório anterior não registrava/);
});
