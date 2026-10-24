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

test("Progress keeps the prioritized study topics from the previous experience", async () => {
  const source = await readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");
  assert.match(source, /insights\.studyTopics\.slice\(0, 3\)/);
  assert.match(source, /Exercício sugerido no relatório/);
  assert.match(source, /Sugestão de exercício geral/);
  assert.match(source, /Seus focos atuais/);
});

test("Progress keeps revealed sections visible and restores the list position after closing a report", async () => {
  const [reveal, progressView, progressContent] = await Promise.all([
    readFile(new URL("src/lib/use-replay-reveal.ts", root), "utf8"),
    readFile(new URL("src/app/components/progress-view.tsx", root), "utf8"),
    readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8"),
  ]);

  assert.match(reveal, /observer\.unobserve\(entry\.target\)/);
  assert.match(reveal, /else if \(!entry\.isIntersecting && !once\)/);
  assert.match(progressView, /<ProgressContent insights=\{insights\} onOpenReport=\{openHistoricalReport\}/);
  assert.match(progressView, /progressScrollTop\.current = window\.scrollY/);
  assert.match(progressView, /window\.requestAnimationFrame\(\(\) => window\.scrollTo\(\{ top: progressScrollTop\.current, behavior: "auto" \}\)\)/);
});

test("Progress labels error percentages directly and omits the hard-to-read per-answer summary", async () => {
  const source = await readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");

  assert.match(source, /Erros de inglês nas respostas/);
  assert.match(source, /Erros de gramática/);
  assert.match(source, /das respostas tiveram esse erro/);
  assert.doesNotMatch(source, /erros por resposta na última entrevista/);
});

test("Sua voz keeps the full metric, practice and evolution experience", async () => {
  const source = await readFile(new URL("src/app/components/voice-view.tsx", root), "utf8");
  assert.match(source, /Visão geral da sua voz/);
  assert.match(source, /Como melhorar/);
  assert.match(source, /Frases para treinar/);
  assert.match(source, /Evolução/);
  assert.match(source, /\/ 100/);
  assert.match(source, /point\.value/);
});
