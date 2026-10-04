import assert from "node:assert/strict";
import test from "node:test";

import { defaultTranscriptionEngine, resolveTranscriptionEngine, transcriptionEngineOptions } from "../src/lib/interview/transcription-engine.mjs";

test("Whisper is the default engine and the options carry the PT-BR copy", () => {
  assert.equal(defaultTranscriptionEngine, "whisper");
  assert.deepEqual(transcriptionEngineOptions.map((option) => [option.value, option.label]), [["whisper", "Whisper (padrão)"], ["ink-2", "Cartesia Ink-2"]]);
  assert.equal(transcriptionEngineOptions[0].helper, "Legenda da sua fala aparece por trecho, a cada pausa.");
  assert.equal(transcriptionEngineOptions[1].helper, "Legenda palavra a palavra; usa créditos da Cartesia (cai para o Whisper se acabarem).");
});

test("configs without a valid engine resolve to Whisper", () => {
  assert.equal(resolveTranscriptionEngine({}), "whisper");
  assert.equal(resolveTranscriptionEngine(undefined), "whisper");
  assert.equal(resolveTranscriptionEngine({ transcriptionEngine: "nope" }), "whisper");
  assert.equal(resolveTranscriptionEngine({ transcriptionEngine: "ink-2" }), "ink-2");
});
