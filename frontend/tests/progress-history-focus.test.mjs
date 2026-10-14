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
