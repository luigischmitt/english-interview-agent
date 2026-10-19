import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Progress lets candidates navigate between available examples accessibly", async () => {
  const source = await readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");

  assert.match(source, /const examples = row\.error\?\.examples \?\? \[\]/);
  assert.match(source, /const example = examples\[exampleIndex\]/);
  assert.doesNotMatch(source, /row\.error\?\.examples\[0\]/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Example \$\{exampleIndex \+ 1\} of \$\{examples\.length\}/);
  assert.match(source, /aria-label=\{t\("Exemplo anterior"\)\} disabled=\{exampleIndex === 0\}/);
  assert.match(source, /aria-label=\{t\("Próximo exemplo"\)\} disabled=\{exampleIndex === examples\.length - 1\}/);
});

test("current study focus explains its report evidence and exercise source", async () => {
  const source = await readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");

  assert.match(source, /Seus focos atuais/);
  assert.match(source, /Foco principal/);
  assert.match(source, /topic\.focuses\[0\]/);
  assert.match(source, /Observado nos relatórios:/);
  assert.match(source, /topic\.exerciseSource === "report" \? "Exercício sugerido no relatório" : "Sugestão de exercício geral"/);
  assert.match(source, /Outros focos/);
});
