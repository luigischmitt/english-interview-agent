import test from "node:test";
import assert from "node:assert/strict";
import { buildRound } from "../src/lib/practice/practice-rounds.mjs";
import { buildPersonalRewriteTargets, composePersonalWordBank, gradePersonalRewrite, normalizePersonalAnswer, shuffledPersonalWordBank } from "../src/lib/practice/personal-rewrites.mjs";
import { extractProgressErrors, findPracticeSyncWork, partitionPracticeSyncWork } from "../src/lib/practice/practice-sync.mjs";
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";

const ref = (sequence, ruleId, evidence, rephrased, createdAt, extra = {}) => ({
  interview_id: `interview-${sequence}`,
  sequence_number: sequence,
  ruleId,
  evidence,
  rephrased,
  created_at: createdAt,
  ...extra,
});

test("invalid, unanchored, and unknown rule targets are ignored", () => {
  const targets = buildPersonalRewriteTargets([{
    theme_key: "prepositions",
    error_refs: [
      ref(1, "prepositions.missing", "I work in Acme.", "I work at Acme.", "2026-01-01"),
      ref(2, "prepositions.at", "", "I work at Acme.", "2026-01-02"),
      ref(3, "prepositions.at", "I work in Acme.", " ".repeat(501), "2026-01-03"),
      { studyPlan: { targets: [{ lessonKey: "prepositions", ruleId: "prepositions.at", target: "I work at Acme." }] } },
    ],
  }], practiceLessons);
  assert.deepEqual(targets, []);
});

test("personal targets accept the optional stored plan shape and rank repeated, recent refs once per rule", () => {
  const groups = [{ theme_key: "prepositions", error_refs: [
    ref(1, "prepositions.in", "I work at Acme.", "I work in Acme.", "2026-01-01"),
    ref(2, "prepositions.at", "I work in Acme.", "I work at Acme.", "2026-02-01", {
      studyPlan: { targets: [{ lessonKey: "prepositions", ruleId: "prepositions.at", evidence: "I work in Acme.", target: "I work at Acme.", acceptedAnswers: ["I work for Acme."], explanation: "Company names use at." }] },
    }),
    ref(3, "prepositions.at", "I work on Acme.", "I work at Acme.", "2026-03-01"),
    ref(4, "prepositions.on", "I work in a project.", "I work on a project.", "2026-04-01"),
  ] }];

  const targets = buildPersonalRewriteTargets(groups, practiceLessons);
  assert.deepEqual(targets.map((item) => item.ruleId), ["prepositions.at", "prepositions.on", "prepositions.in"]);
  assert.equal(targets[0].sentence, "I work in Acme.");
  assert.deepEqual(targets[0].accepted, ["I work at Acme.", "I work for Acme."]);
  assert.equal(targets[0].context, "Company names use at.");
  assert.equal(new Set(targets.map((item) => item.ruleId)).size, targets.length);
});

test("normalization accepts punctuation, case, curly apostrophes, and supplied contractions", () => {
  assert.equal(normalizePersonalAnswer("I’m ready!"), "i am ready");
  assert.notEqual(normalizePersonalAnswer("we were ready"), normalizePersonalAnswer("we’re ready"));
  assert.notEqual(normalizePersonalAnswer("the team changed its API"), normalizePersonalAnswer("the team changed it’s API"));
  assert.notEqual(normalizePersonalAnswer("C++"), normalizePersonalAnswer("C"));
  const exercise = { answer: "I am ready for the interview.", accepted: ["I'm ready for my interview."] };
  assert.equal(gradePersonalRewrite(exercise, "i’m ready for my interview!").verdict, "correct");
  assert.equal(gradePersonalRewrite(exercise, "I AM READY FOR THE INTERVIEW.").verdict, "correct");
});

test("personal grading rejects unrelated paraphrases even when their meaning is similar", () => {
  const exercise = { answer: "I work at Acme.", accepted: ["I am employed at Acme."] };
  assert.equal(gradePersonalRewrite(exercise, "I have a job with Acme.").verdict, "incorrect");
  assert.equal(gradePersonalRewrite(exercise, "I work in Acme.").verdict, "incorrect");
});

test("mine rounds put up to three personal rewrites first and preserve fixed fallback", () => {
  const targets = buildPersonalRewriteTargets([{ theme_key: "prepositions", error_refs: [
    ref(1, "prepositions.at", "I work in Acme.", "I work at Acme.", "2026-01-01"),
  ] }], practiceLessons);
  const personalOnly = buildRound({ mode: "mine", lessons: practiceLessons, personalTargets: targets });
  assert.equal(personalOnly.length, 1);
  assert.equal(personalOnly[0].kind, "personal");
  assert.deepEqual(buildRound({ mode: "mine", lessons: practiceLessons }), []);

  const fixedLesson = { key: "prepositions", exercises: [{ id: "fixed-1", ruleId: "prepositions.at", kind: "spot", sentence: "I work in Acme.", answer: "I work at Acme." }] };
  const mixed = buildRound({ mode: "mine", lessons: [fixedLesson], weights: { "prepositions.at": 1 }, personalTargets: targets, random: () => 0.5 });
  assert.equal(mixed[0].kind, "personal");
  assert.equal(mixed[1].id, "fixed-1");
});

test("recent personal targets are skipped instead of repeated immediately", () => {
  const targets = buildPersonalRewriteTargets([{ theme_key: "prepositions", error_refs: [
    ref(1, "prepositions.at", "I work in Acme.", "I work at Acme.", "2026-01-01"),
  ] }], practiceLessons);
  assert.deepEqual(buildPersonalRewriteTargets([{ theme_key: "prepositions", error_refs: [
    ref(1, "prepositions.at", "I work in Acme.", "I work at Acme.", "2026-01-01"),
  ] }], practiceLessons, [targets[0].id]), []);
});

test("report studyPlan flows through pure sync selection into a local personal rewrite without classification", () => {
  const record = {
    id: "interview-plan",
    createdAt: "2026-06-01",
    patterns: [{ sequenceNumber: 8, evidence: "I work in Acme.", rephrasedExample: "I work at Acme.", type: "GRAMMAR", suggestion: "Company names use at." }],
    feedback: { analysis: { studyPlan: { targets: [{
      lessonKey: "prepositions",
      ruleId: "prepositions.at",
      sourceEvidence: "I work in Acme.",
      correctedTarget: "I work at Acme.",
      acceptedAnswers: ["I work for Acme."],
      explanation: "Company names use at.",
    }] } } },
  };
  const errors = extractProgressErrors([record]);
  const work = findPracticeSyncWork(errors, []);
  const { planned, classify } = partitionPracticeSyncWork(work);
  assert.equal(classify.length, 0);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].category, "prepositions");
  assert.equal(planned[0].ref.sequence_number, 8);
  assert.equal(planned[0].ref.studyPlanTarget.correctedTarget, "I work at Acme.");

  const themes = [{ theme_key: "prepositions", error_refs: planned.map(({ ref }) => ref) }];
  const selected = buildPersonalRewriteTargets(themes, practiceLessons);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sentence, "I work in Acme.");
  assert.deepEqual(selected[0].accepted, ["I work at Acme.", "I work for Acme."]);
  assert.deepEqual(findPracticeSyncWork(errors, themes), []);

  const legacyStored = { interview_id: "interview-plan", sequence_number: 8, evidence: "I work in Acme.", rephrased: "I work at Acme." };
  assert.equal(findPracticeSyncWork(errors, [{ theme_key: "prepositions", error_refs: [legacyStored] }])[0].studyPlanTarget.correctedTarget, "I work at Acme.");
  const emptyPlanFallback = extractProgressErrors([{ ...record, feedback: { analysis: { studyPlan: { targets: [] } } } }]);
  assert.equal(emptyPlanFallback.length, 1);
  assert.equal(emptyPlanFallback[0].category, "other");
  assert.equal(emptyPlanFallback[0].studyPlanFallback, true);
});

test("invalid or empty study plans keep report patterns in deterministic broad groups without classification", () => {
  const record = {
    id: "interview-fallback",
    createdAt: "2026-06-02",
    patterns: [
      { sequenceNumber: 1, evidence: "I pretend to migrate it.", rephrasedExample: "I plan to migrate it.", type: "FALSE_COGNATE", suggestion: "Use plan for intention." },
      { sequenceNumber: 2, evidence: "The service process requests.", rephrasedExample: "The service processes requests.", type: "GRAMMAR", suggestion: "Match the verb to the subject." },
    ],
    feedback: { analysis: { studyPlan: { targets: [{ lessonKey: "missing", ruleId: "no.rule", sourceEvidence: "not in report", correctedTarget: "not valid" }] } } },
  };
  const errors = extractProgressErrors([record]);
  assert.deepEqual(errors.map(({ category, ruleId, studyPlanFallback }) => [category, ruleId, studyPlanFallback]), [
    ["word-choice", null, true], ["other", null, true],
  ]);
  const { planned, classify } = partitionPracticeSyncWork(errors);
  assert.equal(planned.length, 2);
  assert.deepEqual(classify, []);
  const broadGroups = ["word-choice", "other"].map((theme_key) => ({ theme_key, error_refs: errors.filter((item) => item.category === theme_key) }));
  const lessonWeights = Object.fromEntries(broadGroups.map(({ theme_key, error_refs }) => [theme_key, error_refs.length]));
  const fixedRound = buildRound({ mode: "mine", lessons: practiceLessons, lessonWeights, random: () => 0.5 });
  assert.ok(fixedRound.length > 0);
  assert.ok(fixedRound.every((exercise) => exercise.kind !== "personal"));
  const fallback = extractProgressErrors([{ ...record, feedback: { analysis: { studyPlan: { targets: [] } } } }]);
  assert.equal(fallback.length, 2);
});

test("corrected-token bank contains every target word, starts shuffled, and composes locally", () => {
  const target = "I built a reliable API for our customers.";
  const bank = shuffledPersonalWordBank(target, "exercise-1");
  const secondBank = shuffledPersonalWordBank(target, "exercise-1");
  assert.deepEqual(bank, secondBank);
  assert.equal(bank.length, target.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu).length);
  assert.notDeepEqual(bank.map(({ id }) => id), bank.map((_, index) => index));
  assert.equal(composePersonalWordBank(target, bank.map((_, index) => index)), target);
  assert.notEqual(composePersonalWordBank(target, bank.map(({ id }) => id)), target);
});
