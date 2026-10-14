import test from "node:test";
import assert from "node:assert/strict";
import { progressDimensionKindLabel, visibleProgressDimensions } from "../src/app/components/progress/progress-dimensions.mjs";

test("hides pattern dimensions without occurrences and preserves dimensions with data", () => {
  const dimensions = [
    { key: "GRAMMAR", kind: "pattern", value: 100 },
    { key: "WORD_CHOICE", kind: "pattern", value: 0 },
    { key: "accuracy", kind: "voice", value: 0 },
    { key: "fluency", kind: "voice", value: 78 },
  ];

  assert.deepEqual(visibleProgressDimensions(dimensions), [dimensions[0], dimensions[2], dimensions[3]]);
});

test("labels visible pattern dimensions as observed and voice dimensions as speech", () => {
  assert.equal(progressDimensionKindLabel("pattern"), "Padrão observado");
  assert.equal(progressDimensionKindLabel("voice"), "Fala");
});
