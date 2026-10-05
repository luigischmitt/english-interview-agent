import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const design = readFileSync(new URL("../../DESIGN.md", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/app/home-client.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/app/components/shell.css", import.meta.url), "utf8");
const setup = readFileSync(new URL("../src/app/components/interview-setup.tsx", import.meta.url), "utf8");
const progress = readFileSync(new URL("../src/app/components/progress/progress-content.tsx", import.meta.url), "utf8");
const progressCss = readFileSync(new URL("../src/app/components/progress/progress.css", import.meta.url), "utf8");

function schemeTokens(scheme) {
  const marker = scheme === "dark" ? ':root[data-color-scheme="dark"] {' : ":root {";
  const searchFrom = scheme === "dark" ? 0 : globals.indexOf("/*\n * Design tokens");
  let start = globals.indexOf(marker, searchFrom);
  let block = "";
  while (start >= 0) {
    const end = globals.indexOf("}", start);
    if (end < 0) break;
    const candidate = globals.slice(start, end);
    if (candidate.includes("--ds-brand-warm:")) {
      block = candidate;
      break;
    }
    start = globals.indexOf(marker, end + 1);
  }
  assert.ok(block.includes("--ds-brand-warm:"), `missing ${scheme} color tokens`);
  const color = (name) => {
    const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "iu"))?.[1];
    assert.ok(value, `missing ${name} in ${scheme} tokens`);
    return value;
  };
  return { accent: color("--ds-brand-warm"), surfaces: ["--ds-cream", "--ds-surface", "--ds-field", "--ds-panel", "--ds-sidebar"].map(color) };
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../gu).map((pair) => Number.parseInt(pair, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("the warm bird accent keeps 3:1 contrast on light and dark app surfaces", () => {
  for (const scheme of ["light", "dark"]) {
    const tokens = schemeTokens(scheme);
    for (const surface of tokens.surfaces) {
      assert.ok(contrast(tokens.accent, surface) >= 3, `${scheme} ${tokens.accent} on ${surface}`);
    }
  }
  assert.match(design, /`--ds-brand-warm` is a small decorative accent[\s\S]+never use it for text, status/u);
});

test("authenticated Home carries its Brazilian signature and retains its optimized forest detail", () => {
  assert.match(home, /Feito no Brasil, para vaga lá fora/u);
  assert.match(home, /data-home-item=\{id === "home" \? "true" : undefined\}/u);
  assert.match(home, /src="\/landing\/footer-mata-alpha\.png"[\s\S]+alt=""[\s\S]+aria-hidden="true"[\s\S]+fill/u);
  assert.match(shell, /\.shl-nav-item\[data-home-item="true"\]\[aria-current="page"\] svg \{ color: var\(--ds-brand-warm\); \}/u);
  assert.match(shell, /\.shl-hero-forest[\s\S]+pointer-events: none/u);
});

test("setup and true first-use progress marks remain decorative", () => {
  assert.match(setup, /<Leaf className="size-3\.5 text-\[color:var\(--ds-brand-warm\)\]" aria-hidden="true" \/>/u);
  assert.match(progress, /insights\.sessionCount === 0 && <span className="pg-tucano" aria-hidden="true" \/>/u);
  assert.match(progressCss, /\.pg-tucano \{[^}]*tucano-mark\.webp/u);
});
