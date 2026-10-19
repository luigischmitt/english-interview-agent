import test from "node:test";
import assert from "node:assert/strict";
import { analysisCoverageNotice, buildReportDeltas, diffReportWords, displayInterviewerTakeaway, displayTechnicalFindings, isCompleteSentence, phonemeTip } from "../src/lib/interview/report-presentation.mjs";

test("word diff marks only changed words and preserves shared words", () => {
  assert.deepEqual(diffReportWords("I made a test.", "We ran a test."), {
    original: [{ text: "I", changed: true }, { text: " ", changed: false }, { text: "made", changed: true }, { text: " ", changed: false }, { text: "a", changed: false }, { text: " ", changed: false }, { text: "test", changed: false }, { text: ".", changed: false }],
    revised: [{ text: "We", changed: true }, { text: " ", changed: false }, { text: "ran", changed: true }, { text: " ", changed: false }, { text: "a", changed: false }, { text: " ", changed: false }, { text: "test", changed: false }, { text: ".", changed: false }],
  });
});

test("phoneme tips cover Azure symbols and use a safe fallback", () => {
  assert.match(phonemeTip("θ"), /língua entre os dentes/u);
  assert.match(phonemeTip("iy"), /i mais longo/u);
  assert.match(phonemeTip(undefined, "worked"), /-ed/u);
  assert.equal(phonemeTip("unknown"), "pronuncie cada sílaba com clareza");
});

test("report deltas describe direction for the latest previous completed ready report", () => {
  const records = [
    { id: "current", status: "completed", feedback: { status: "ready", analysis: {} } },
    { id: "older", status: "completed", completedAt: "2026-01-01", answerCount: 2, feedback: { status: "ready", analysis: { englishCommunication: { patterns: [{}, {}] }, technicalContent: { gaps: [{}] } }, azureSummary: { accuracy: { mean: 70 }, answers: [{ delivery: { wordsPerMinute: 110 } }] } } },
    { id: "newest", status: "completed", completedAt: "2026-02-01", answerCount: 2, feedback: { status: "ready", analysis: { englishCommunication: { patterns: [{}] }, technicalContent: { gaps: [{}] } }, azureSummary: { accuracy: { mean: 80 }, answers: [{ delivery: { wordsPerMinute: 125 } }] } } },
  ];
  const deltas = buildReportDeltas({ englishCommunication: { patterns: [{}, {}] }, technicalContent: { gaps: [{}, {}, {}] } }, { accuracy: { mean: 82 }, answers: [{ delivery: { wordsPerMinute: 130 } }] }, records, "current", 2);
  assert.equal(deltas[0].before, "0,5");
  assert.equal(deltas[0].after, "1");
  assert.equal(deltas[0].change, "worse");
  assert.match(deltas[0].label, /^Mais erros de inglês/u);
  assert.match(deltas[1].label, /^Mais lacunas técnicas/u);
  assert.match(deltas.find((delta) => /Fala mais rápida/u.test(delta.label)).label, /125 → 130 palavras por minuto/u);
  assert.match(deltas.find((delta) => /Precisão da pronúncia/u.test(delta.label)).label, /^Precisão da pronúncia maior/u);
  assert.deepEqual(buildReportDeltas({}, {}, [], undefined, 1), []);
});

test("report deltas use equal copy, omit tiny pace changes, and hide an incomplete comparison base", () => {
  const previous = { id: "previous", status: "completed", completedAt: "2026-02-01", answerCount: 2, feedback: { status: "ready", analysis: { englishCommunication: { patterns: [{}] }, technicalContent: { gaps: [{}] } }, azureSummary: { accuracy: { mean: 90 }, answers: [{ delivery: { wordsPerMinute: 100 } }] } } };
  const current = { englishCommunication: { patterns: [{}] }, technicalContent: { gaps: [{}] } };
  const deltas = buildReportDeltas(current, { accuracy: { mean: 90.5 }, answers: [{ delivery: { wordsPerMinute: 103 } }] }, [previous], "current", 2);
  assert.match(deltas[0].label, /^Erros de inglês por resposta iguais/u);
  assert.equal(deltas.some((delta) => /palavras por minuto/u.test(delta.label)), false);
  assert.match(deltas.at(-1).label, /^Precisão da pronúncia igual/u);
  assert.deepEqual(buildReportDeltas({ ...current, analysisCoverage: { analyzedTurnCount: 1, totalTurnCount: 2, missingSequenceNumbers: [3] } }, {}, [previous], "current", 2), []);
  previous.feedback.analysis.analysisCoverage = { analyzedTurnCount: 1, totalTurnCount: 2, missingSequenceNumbers: [3] };
  assert.deepEqual(buildReportDeltas(current, {}, [previous], "current", 2), []);
});

test("incomplete explanations and contradictory positive points stay out of the report", () => {
  assert.equal(isCompleteSentence("Em português, usamos"), false);
  assert.equal(isCompleteSentence("O presente simples ."), false);
  assert.equal(isCompleteSentence("Em português, o verbo muda conforme o sujeito."), true);
  const technical = displayTechnicalFindings(
    [{ explanation: "Você explicou o critério de escolha.", evidence: "we chose based on cost" }, { explanation: "Frase incompleta", evidence: "x" }],
    [{ explanation: "Faltou explicar o critério de escolha.", evidence: "we chose based on cost" }],
  );
  assert.deepEqual(technical.strengths, []);
  assert.equal(technical.gaps.length, 1);
  assert.deepEqual(displayInterviewerTakeaway({ remember: "Você explicou o critério de escolha.", concern: "Faltou explicar o critério de escolha." }), { remember: null, concern: "Faltou explicar o critério de escolha." });
  assert.deepEqual(displayTechnicalFindings([{ explanation: "Você explicou o critério de escolha.", evidence: "x" }], [], [{ explanation: "Faltou explicar o critério de escolha." }]).strengths, []);
});

test("coverage notice uses visible answer ordinals and only appears for an incomplete report", () => {
  assert.equal(analysisCoverageNotice({ analyzedTurnCount: 2, totalTurnCount: 3, missingSequenceNumbers: [5] }, (sequenceNumber) => ({ 5: 2 })[sequenceNumber]), "Não conseguimos analisar a resposta 2. Os pontos abaixo cobrem as outras respostas.");
  assert.equal(analysisCoverageNotice({ analyzedTurnCount: 3, totalTurnCount: 3, missingSequenceNumbers: [] }), null);
});
