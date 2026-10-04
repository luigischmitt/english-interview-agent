import assert from "node:assert/strict";
import test from "node:test";
import { interviewRoles } from "../src/lib/interview/roles.ts";
import { genericQuestionBank, getQuestionBankForRole, questionBankRoles } from "../src/lib/interview/question-bank.mjs";

const allBanks = [...interviewRoles.map((role) => [role, getQuestionBankForRole(role)]), ["generic", genericQuestionBank]];

test("every listed role has its own bank of exactly 15 questions", () => {
  assert.deepEqual([...questionBankRoles].sort(), [...interviewRoles].sort());
  for (const [role, bank] of allBanks) {
    assert.equal(bank.length, 15, role);
    if (role !== "generic") assert.notEqual(bank, genericQuestionBank, role);
  }
});

test("unknown or empty roles fall back to the generic bank", () => {
  assert.equal(getQuestionBankForRole("Astronaut"), genericQuestionBank);
  assert.equal(getQuestionBankForRole(""), genericQuestionBank);
  assert.equal(getQuestionBankForRole(undefined), genericQuestionBank);
});

test("role matching ignores case and surrounding spaces and accepts common variants", () => {
  assert.equal(getQuestionBankForRole("  backend ENGINEER "), getQuestionBankForRole("Backend Engineer"));
  assert.equal(getQuestionBankForRole("SRE"), getQuestionBankForRole("Site Reliability Engineer"));
  assert.equal(getQuestionBankForRole("fullstack engineer"), getQuestionBankForRole("Full-Stack Engineer"));
  assert.equal(getQuestionBankForRole("ML engineer"), getQuestionBankForRole("Machine Learning Engineer"));
  assert.equal(getQuestionBankForRole("QA engineer"), getQuestionBankForRole("QA Automation Engineer"));
});

test("every prompt is a single short spoken question", () => {
  for (const [role, bank] of allBanks) {
    for (const question of bank) {
      const prompt = question.prompt.replace("{role}", "Backend Engineer");
      assert.ok(prompt.length <= 220, `${role}/${question.id} is too long`);
      assert.ok(!/[\r\n]/.test(prompt), `${role}/${question.id} has a line break`);
      assert.equal(prompt.split("?").length - 1, 1, `${role}/${question.id} needs exactly one question mark`);
      assert.ok(prompt.endsWith("?"), `${role}/${question.id} must end with ?`);
      assert.ok(question.cue.trim().length > 0, `${role}/${question.id} needs a cue`);
    }
  }
});

test("ids are unique kebab-case, and each bank starts with the introduction and ends with the closing", () => {
  for (const [role, bank] of allBanks) {
    const ids = bank.map((question) => question.id);
    assert.equal(new Set(ids).size, ids.length, role);
    for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${role}/${id}`);
    assert.equal(ids[0], "introduction", role);
    assert.equal(ids.at(-1), "closing", role);
    assert.equal(new Set(bank.map((question) => question.prompt)).size, bank.length, role);
  }
});

test("only the introduction uses the {role} placeholder", () => {
  for (const [role, bank] of allBanks) {
    assert.ok(bank[0].prompt.includes("{role}"), role);
    assert.ok(bank.slice(1).every((question) => !question.prompt.includes("{role}")), role);
  }
});
