import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("keeps a saved session focus available to the historical report config", async () => {
  const [types, persistence, progressView] = await Promise.all([
    readFile(new URL("src/lib/interview/progress-insights.d.mts", root), "utf8"),
    readFile(new URL("src/lib/interview/persistence.ts", root), "utf8"),
    readFile(new URL("src/app/components/progress-view.tsx", root), "utf8"),
  ]);

  assert.match(types, /targetRole: string;\s*focus: string \| null;/);
  assert.match(persistence, /focus: session\.focus,/);
  assert.match(progressView, /focus: selectedSession\.focus \?\? "mixed",/);
});

test("makes every saved interview recoverable from history and returns from the top of reports", async () => {
  const [history, report, progressView] = await Promise.all([
    readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8"),
    readFile(new URL("src/app/components/interview-report.tsx", root), "utf8"),
    readFile(new URL("src/app/components/progress-view.tsx", root), "utf8"),
  ]);

  assert.match(history, /\{onOpenReport && \(\s*<span className="pg-row-open"/);
  assert.match(history, /onClick=\{\(\) => onOpenReport\(s\.id\)\}/);
  assert.match(report, /historical && <button type="button" className="ds-btn ds-btn-quiet mb-3" onClick=\{onLeave\}>/);
  assert.match(report, /getCurrentLocale\(\) === "en" \? "Back to Progress" : t\("Voltar ao Progresso"\)/);
  assert.match(report, /<CapturedAnswers turns=\{loadedTurns\} \/>/);
  assert.match(report, /Tentar gerar novamente/);
  assert.match(progressView, /requestPersistedInterviewReport\(sessionId/);
  assert.match(progressView, /selectedReportState\.status !== "pending"/);
  assert.match(progressView, /setTimeout\(\(\) => \{ void refresh\(\); \}, 2_500\)/);
  assert.match(progressView, /turns=\{\[\]\}/);
  assert.match(report, /onClick=\{onLeave\}>\{t\(historical \? "Voltar ao Progresso /);
});

test("labels the English profile as prioritized patterns found, not as a complete error-free score", async () => {
  const [progress, locale, staticDemo] = await Promise.all([
    readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8"),
    readFile(new URL("src/lib/locale.tsx", root), "utf8"),
    readFile(new URL("public/entoa/index.html", root), "utf8"),
  ]);
  assert.match(progress, /% das respostas sem erro prioritário identificado/);
  assert.match(locale, /% of answers without a prioritized issue identified/);
  assert.match(staticDemo, /% das respostas sem erro prioritário identificado/);
  assert.doesNotMatch(progress, /% das respostas sem erro\"/);
  assert.doesNotMatch(staticDemo, /% das respostas sem erro`/);
});

test("translates persisted report recovery errors in the English interface", async () => {
  const locale = await readFile(new URL("src/lib/locale.tsx", root), "utf8");
  assert.match(locale, /"Não foi possível gerar o relatório agora\. Tente novamente\.": "The report could not be generated right now\. Please try again\."/);
  assert.match(locale, /"Conclua a entrevista antes de gerar o relatório\.": "Finish the interview before generating its report\."/);
});
