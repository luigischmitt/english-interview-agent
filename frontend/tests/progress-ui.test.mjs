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

test("Progress directs candidates to their voice excerpts or a new interview", async () => {
  const source = await readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");
  assert.match(source, /href="\/dashboard\?view=voice"/);
  assert.match(source, /href="\/dashboard\?view=interview-setup"/);
  assert.doesNotMatch(source, /studyTopics|Exercício sugerido no relatório|Sugestão de exercício geral/);
});

test("Progress keeps revealed sections visible and restores the list position after closing a report", async () => {
  const [reveal, progressView, progressContent] = await Promise.all([
    readFile(new URL("src/lib/use-replay-reveal.ts", root), "utf8"),
    readFile(new URL("src/app/components/progress-view.tsx", root), "utf8"),
    readFile(new URL("src/app/components/progress/progress-content.tsx", root), "utf8"),
  ]);

  assert.match(reveal, /observer\.unobserve\(entry\.target\)/);
  assert.match(reveal, /else if \(!entry\.isIntersecting && !once\)/);
  assert.match(progressContent, /useReplayReveal\(rootRef, \[insights\], \{ once: true \}\)/);
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

test("Sua voz compares a candidate's own attempts without absolute scores", async () => {
  const source = await readFile(new URL("src/app/components/voice-view.tsx", root), "utf8");
  assert.match(source, /O que mudou entre tentativas/);
  assert.match(source, /sem mudança no sinal/);
  assert.match(source, /Sinais experimentais do Azure, calibrados em en-US/);
  assert.doesNotMatch(source, /\/\s*100|point\.value/);
});
