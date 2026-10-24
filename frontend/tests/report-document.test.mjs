import test from "node:test";
import assert from "node:assert/strict";
import { buildErrorRows, buildJobCoverage, buildPracticePriorities, buildVoiceNotes, formatReportDate, reportFileBase, reportSummaryText } from "../src/lib/interview/report-document.mjs";

const date = new Date(2026, 9, 24, 12);

test("file base is a lowercase accent-free slug with the local date", () => {
  assert.equal(reportFileBase("Senior Software Engineer", date), "relatorio-senior-software-engineer-2026-10-24");
  assert.equal(reportFileBase("Engenheiro de Dados Sênior (Pleno) / Backend!", date), "relatorio-engenheiro-de-dados-senior-pleno-backend-2026-10-24");
  assert.equal(reportFileBase("backend ".repeat(10), date), `relatorio-${"backend-".repeat(7)}back-2026-10-24`);
  for (const role of ["", "   ", null, undefined, "!!!"]) {
    assert.equal(reportFileBase(role, date), "relatorio-entrevista-2026-10-24");
  }
});

test("document date formats in pt-BR and en, and falls back for invalid input", () => {
  assert.equal(formatReportDate(new Date(2026, 9, 24), "pt-BR"), "24 out. 2026");
  assert.equal(formatReportDate(new Date(2026, 9, 24), "en"), "Oct 24, 2026");
  assert.equal(formatReportDate(new Date(2026, 4, 3)), "3 mai. 2026");
  assert.equal(formatReportDate("2026-10-24"), "24 out. 2026");
  assert.equal(formatReportDate("2026-02-30", "pt-BR", new Date(2026, 0, 5)), "5 jan. 2026");
  assert.equal(formatReportDate("not a date", "en", new Date(2026, 0, 5)), "Jan 5, 2026");
  assert.equal(formatReportDate(null, "pt-BR", new Date(2026, 6, 9)), "9 jul. 2026");
  assert.equal(formatReportDate(new Date("invalid"), "en", new Date(2026, 6, 9)), "Jul 9, 2026");
});

test("summary joins the technical summary and English overview without repeating text", () => {
  const technical = "Você explicou o cache com clareza e citou trade-offs.";
  assert.equal(reportSummaryText({
    technicalContent: { summary: technical },
    overview: { english: "Seu inglês ficou compreensível, com erros de artigo." },
  }), `${technical} Seu inglês ficou compreensível, com erros de artigo.`);
  assert.equal(reportSummaryText({
    technicalContent: { summary: technical },
    overview: { english: "Você explicou o cache com clareza e citou trade-offs." },
  }), technical);
  assert.equal(reportSummaryText({
    technicalContent: { summary: "Ela explica o modelo e" },
    overview: { english: "Seu inglês ficou claro." },
  }), "Seu inglês ficou claro.");
  assert.equal(reportSummaryText({ technicalContent: { summary: "Incompleto..." }, overview: {} }), "");
  assert.equal(reportSummaryText(undefined), "");
});

test("job coverage reports shown, partial and missing competencies", () => {
  const coverage = buildJobCoverage(
    [" Node.js ", "node.js", "Comunicação", "Kubernetes", "AWS"],
    [{ vacancyCompetency: "node.js" }, { vacancyCompetency: "AWS Lambda" }],
    [{ vacancyCompetency: "Comunicação clara" }],
  );
  assert.deepEqual(coverage, [
    { competency: "Node.js", status: "shown" },
    { competency: "Comunicação", status: "partial" },
    { competency: "Kubernetes", status: "missing" },
    { competency: "AWS", status: "missing" },
  ]);
});

test("job coverage matches accent-insensitively, caps at six items and tolerates missing competencies", () => {
  const coverage = buildJobCoverage(
    ["Dados", "Lideranca", "a", "b", "c", "d", "e", "f"],
    [{ vacancyCompetency: "liderança técnica" }, { vacancyCompetency: "Dados" }],
  );
  assert.equal(coverage.length, 6);
  assert.deepEqual(coverage[0], { competency: "Dados", status: "shown" });
  assert.deepEqual(coverage[1], { competency: "Lideranca", status: "shown" });
  assert.deepEqual(buildJobCoverage(undefined), []);
  assert.deepEqual(buildJobCoverage(["  ", ""]), []);
});

test("error rows keep input order, skip unusable patterns and prefer the reason note", () => {
  const rows = buildErrorRows([
    { type: "GRAMMAR", sequenceNumber: 1, evidence: "I am agree.", rephrasedExample: "I agree.", why: "Agree é um verbo, não um adjetivo.", suggestion: "Use I agree." },
    null,
    { type: "WORD_CHOICE", sequenceNumber: 2, evidence: "", rephrasedExample: "x" },
    { type: "WORD_CHOICE", sequenceNumber: 3, evidence: "I agree", rephrasedExample: "i agree!" },
    { type: "STRUCTURE", sequenceNumber: 4, evidence: "yes, i did it", rephrasedExample: "I did it." },
    { type: "STRUCTURE", sequenceNumber: 5, evidence: "Yes, I did it.", rephrasedExample: "I did it too." },
    { type: "FALSE_COGNATE", sequenceNumber: 6, evidence: "He is actual.", rephrasedExample: "He is current.", why: "Porque…", suggestion: "Prefira current." },
    { type: "GRAMMAR", sequenceNumber: 7, evidence: "She go.", rephrasedExample: "She goes.", why: "Incompleto —", suggestion: null },
    { type: "GRAMMAR", sequenceNumber: 8, evidence: "Missing rephrase" },
  ]);
  assert.deepEqual(rows.map((row) => row.sequenceNumber), [1, 4, 6, 7]);
  assert.equal(rows[0].note, "Agree é um verbo, não um adjetivo.");
  assert.equal(rows[0].type, "GRAMMAR");
  assert.equal(rows[1].note, null);
  assert.equal(rows[2].note, "Prefira current.");
  assert.equal(rows[3].note, null);
  assert.ok(rows[0].said.some((part) => part.changed && part.text === "am"));
  assert.ok(rows[0].right.every((part) => !part.changed));
  assert.deepEqual(buildErrorRows(), []);
});

test("voice notes keep fixed order, null missing samples and clamp values", () => {
  assert.deepEqual(buildVoiceNotes({
    accuracy: { mean: 72.4, sampleCount: 3 },
    fluency: { mean: 80, sampleCount: 0 },
    prosody: { mean: 150, sampleCount: 2 },
  }), [
    { key: "accuracy", label: "Precisão", measure: "Clareza de cada som", value: 72 },
    { key: "fluency", label: "Ritmo", measure: "Pausas e velocidade", value: null },
    { key: "prosody", label: "Prosódia", measure: "Entonação e acento", value: 100 },
  ]);
  const withoutMetrics = buildVoiceNotes(undefined);
  assert.deepEqual(withoutMetrics.map((note) => note.key), ["accuracy", "fluency", "prosody"]);
  assert.ok(withoutMetrics.every((note) => note.value === null));
  assert.equal(buildVoiceNotes({ accuracy: { mean: null, sampleCount: 2 }, prosody: { mean: -5, sampleCount: 1 } })[2].value, 0);
});

test("practice priorities come from the report focuses first, limited to three", () => {
  const priorities = buildPracticePriorities({
    priorities: [
      { area: "TECHNICAL_CONTENT", sequenceNumber: 2, focus: " Explique trade-offs " },
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 3, focus: "" },
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 4, focus: "Use o artigo" },
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 5, focus: "Fale sobre métricas" },
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 6, focus: "Pausas curtas" },
    ],
    englishCommunication: { patterns: [{ type: "GRAMMAR", evidence: "He go" }] },
  });
  assert.deepEqual(priorities, [
    { title: "Explique trade-offs", area: "technical", sequenceNumber: 2, count: null },
    { title: "Use o artigo", area: "english", sequenceNumber: 4, count: null },
    { title: "Fale sobre métricas", area: "english", sequenceNumber: 5, count: null },
  ]);
});

test("practice priority fallback counts English types once per evidence across both sources", () => {
  const priorities = buildPracticePriorities({
    priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 1, focus: "" }],
    englishCommunication: {
      patterns: [
        { type: "GRAMMAR", sequenceNumber: 1, evidence: "I am agree" },
        { type: "FALSE_COGNATE", sequenceNumber: 2, evidence: "It is actual" },
      ],
    },
    turns: [
      { englishPatterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "i am agree." }, { type: "GRAMMAR", sequenceNumber: 3, evidence: "He go home" }] },
      { englishPatterns: [{ type: "STRUCTURE", sequenceNumber: 5, evidence: "Why you think" }, { type: "WORD_CHOICE", sequenceNumber: 6, evidence: "make a question" }, { type: "UNKNOWN", sequenceNumber: 7, evidence: "other" }] },
      null,
    ],
  });
  assert.deepEqual(priorities, [
    { title: "Gramática", area: "english", sequenceNumber: null, count: 2 },
    { title: "Falsos cognatos", area: "english", sequenceNumber: null, count: 1 },
    { title: "Estrutura", area: "english", sequenceNumber: null, count: 1 },
  ]);
  assert.deepEqual(buildPracticePriorities({}), []);
});
