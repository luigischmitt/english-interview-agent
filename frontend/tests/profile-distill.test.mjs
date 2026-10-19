import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const progress = readFileSync(new URL("src/app/components/progress/progress-content.tsx", root), "utf8");
const radar = readFileSync(new URL("src/app/components/charts/profile-radar.tsx", root), "utf8");
const progressStyles = readFileSync(new URL("src/app/components/progress/progress.css", root), "utf8");
const landing = readFileSync(new URL("public/entoa/index.html", root), "utf8");

test("Progress keeps one radar for dimension values and a keyboard/touch explanation", () => {
  assert.match(progress, /<ProfileRadar[\s\S]*?onSelect=\{setPicked\}/);
  assert.match(progress, /pg-side-detail[\s\S]*?aria-live="polite"><strong>\{active\.label\}\.<\/strong> \{active\.explain\}/);
  assert.doesNotMatch(progress, /pg-dims-cells|pg-side-k|Ponto forte|Ponto de atenção/);
  assert.doesNotMatch(progress, /analyzedAnswers\} answers without this error|respostas sem esse erro/);
  assert.doesNotMatch(progressStyles, /\.pg-dims-cells|\.pg-dim\s/);
  assert.match(radar, /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-pressed=/);
  assert.match(radar, /onClick=\{\(\) => onSelect\(item\.key\)\}/);
  assert.match(radar, /className="pr-label"[\s\S]*?onClick=\{\(\) => onSelect\(item\.key\)\}/);
  assert.match(radar, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("public report shows the radar and correction example without a repeated dimension grid", () => {
  assert.match(landing, /id="radar" role="group"/);
  assert.match(landing, /stage-art[\s\S]+hero-mata\.webp/);
  assert.doesNotMatch(landing, /@media\(max-width:767px\)\{\.stage-art\{display:none\}\}/);
  assert.match(landing, /experience <s>on<\/s> <strong>in<\/strong> backend/);
  assert.match(landing, /role:'button',tabindex:'0'/);
  assert.match(landing, /hit\.addEventListener\('click'/);
  assert.match(landing, /hit\.addEventListener\('keydown'/);
  assert.match(landing, /g\.addEventListener\('click'/);
  assert.match(landing, /detail\.innerHTML=`<strong>\$\{DIM\[on\]\[0\]\}\.<\/strong> \$\{DIM\[on\]\[3\]\}`/);
  assert.doesNotMatch(landing, /rep-sum|dg-cells|dimsEn|dimsVoz|class="dims"/);
});
