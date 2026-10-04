import assert from "node:assert/strict";
import test from "node:test";
import { answerCountLabel, azureMetricCopy, azureReportIntro, clarityHelp, englishPatternsHelp } from "../src/lib/interview/report-metric-copy.mjs";

const allCopy = [azureReportIntro, clarityHelp, englishPatternsHelp, ...Object.values(azureMetricCopy).flatMap(({ help }) => [help])].join(" ");

test("metric copy never presents pronunciation or clarity as an overall English level or CEFR", () => {
  assert.match(azureReportIntro, /n[ãa]o representam seu n[ií]vel geral de ingl[êe]s/i);
  assert.match(clarityHelp, /n[ãa]o avalia pron[úu]ncia nem [ée] um n[ií]vel de ingl[êe]s/i);
  assert.doesNotMatch(allCopy, /\b(A1|A2|B1|B2|C1|C2|CEFR|fluente|avançado)\b/i);
});

test("copy explains that transcription errors can lower the scores", () => {
  assert.match(azureReportIntro, /erro de transcri[çc][ãa]o/i);
});

test("each Azure dimension has a label and a short explanation", () => {
  assert.deepEqual(Object.keys(azureMetricCopy), ["accuracy", "fluency", "prosody"]);
  for (const { label, help } of Object.values(azureMetricCopy)) {
    assert.ok(label.length > 0);
    assert.ok(help.length > 40 && help.length < 260);
  }
});

test("sample counts are labeled as answers, not audio segments", () => {
  assert.equal(answerCountLabel(1), "1 resposta avaliada");
  assert.equal(answerCountLabel(3), "3 respostas avaliadas");
});
