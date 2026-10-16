import test from "node:test";
import assert from "node:assert/strict";
import { deriveOverviewTiles, flattenAndRankPhrases, groupPatternsByType } from "../src/lib/interview/report-overview.mjs";

test("groups English patterns by type while preserving occurrence order", () => {
  const grouped = groupPatternsByType([{ type: "GRAMMAR", sequenceNumber: 1 }, { type: "WORD_CHOICE", sequenceNumber: 2 }, { type: "GRAMMAR", sequenceNumber: 3 }]);
  assert.deepEqual(grouped.map((item) => [item.type, item.items.length]), [["GRAMMAR", 2], ["WORD_CHOICE", 1]]);
});

test("overview uses backend qualitative copy and neutral count fallback", () => {
  const result = { overview: { technical: "Boa síntese." }, technicalContent: { strengths: [{}, {}], gaps: [{}] }, englishCommunication: { patterns: [{}, {}] } };
  const tiles = deriveOverviewTiles(result, [{ scores: { prosody: 80 } }]);
  assert.equal(tiles[0].text, "Boa síntese.");
  assert.equal(tiles[1].text, "2 padrões de inglês observados");
  assert.equal(tiles[2].id, "voice");
});

test("flattens phrases across answers, ranks worst first, and attaches answer number and clip", () => {
  const phrases = flattenAndRankPhrases([{ sequenceNumber: 5, phrases: [{ phraseIndex: 0, score: 70 }, { phraseIndex: 1, score: 30 }], clips: [{ phraseIndex: 1, path: "clip" }] }, { sequenceNumber: 9, phrases: [{ phraseIndex: 0, score: 50 }] }], [{ sequenceNumber: 5 }, { sequenceNumber: 9 }], 2);
  assert.deepEqual(phrases.map((item) => [item.score, item.ordinal]), [[30, 1], [50, 2]]);
  assert.equal(phrases[0].clip.path, "clip");
});
