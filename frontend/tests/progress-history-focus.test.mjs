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

test("makes ready history reports discoverable and returns from the top of historical reports", async () => {
  const [history, report, progressView] = await Promise.all([
    readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8"),
    readFile(new URL("src/app/components/interview-report.tsx", root), "utf8"),
    readFile(new URL("src/app/components/progress-view.tsx", root), "utf8"),
  ]);

  assert.match(history, /s\.reportStatus === "ready" && onOpenReport && \(\s*<span className="pg-row-open"/);
  assert.match(history, /onClick=\{\(\) => onOpenReport\(s\.id\)\}/);
  assert.match(report, /\{historical && \(\s*<button type="button" className="ds-btn ds-btn-quiet mb-3" onClick=\{onLeave\}>/);
  assert.match(report, /getCurrentLocale\(\) === "en" \? "Back to Progress" : t\("Voltar ao Progresso"\)/);
  assert.match(report, /\{!historical && <CapturedAnswers turns=\{turns\} \/>\}/);
  assert.match(progressView, /turns=\{\[\]\}/);
  assert.match(report, /onClick=\{onLeave\}>\{t\(historical \? "Voltar ao Progresso /);
});
