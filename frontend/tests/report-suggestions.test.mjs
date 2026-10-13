import test from "node:test";
import assert from "node:assert/strict";
import { buildReportSuggestions } from "../src/lib/practice/report-suggestions.mjs";

const ref = (interview_id, evidence, ruleId, extra = {}) => ({ interview_id, sequence_number: 1, evidence, rephrased: `${evidence}!`, ruleId, ...extra });

test("keeps only this interview, groups by lesson part and orders by count then appearance", () => {
  const groups = [
    { theme_key: "prepositions", error_refs: [ref("a", "in Google", "prepositions.at"), ref("b", "other", "prepositions.on"), ref("a", "on 2019", "prepositions.in")] },
    { theme_key: "articles", error_refs: [ref("a", "I have API"), ref("a", "I use tool")] },
    { theme_key: "_ignored", error_refs: [ref("a", "ignored")] },
    { theme_key: "legacy-x", error_refs: [ref("a", "legacy")] },
  ];
  const out = buildReportSuggestions(groups, "a");
  assert.deepEqual(out.map((s) => s.evidence), ["I have API", "in Google", "on 2019"]);
  assert.equal(out[0].count, 2);
  assert.equal(out[0].ruleId, null);
  assert.equal(out[0].partLabel, null);
  assert.equal(out[1].partLabel, "at");
  assert.equal(out[1].href, "/dashboard?view=train&lesson=prepositions&part=prepositions.at");
  assert.equal(out[0].href, "/dashboard?view=train&lesson=articles");
});

test("limits results and handles empty or unknown input", () => {
  const groups = [{ theme_key: "prepositions", error_refs: ["at", "on", "in", "for"].map((r) => ref("a", r, `prepositions.${r}`)) }];
  assert.equal(buildReportSuggestions(groups, "a").length, 3);
  assert.deepEqual(buildReportSuggestions(groups, "zzz"), []);
  assert.deepEqual(buildReportSuggestions(groups, null), []);
  assert.equal(buildReportSuggestions([{ theme_key: "articles", error_refs: [ref("a", "x", "bogus.rule")] }], "a")[0].ruleId, null);
});
