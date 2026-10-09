import assert from "node:assert/strict";
import test from "node:test";
import { interviewRoles } from "../src/lib/interview/roles.ts";
import { getFixedInterviewQuestions } from "../src/lib/interview/questions.ts";
import { genericJuniorQuestionBank, genericQuestionBank, getQuestionBankForRole, questionBankRoles } from "../src/lib/interview/question-bank.mjs";

const allBanks = [
  ...interviewRoles.map((role) => [role, getQuestionBankForRole(role)]),
  ["generic", genericQuestionBank],
  ...interviewRoles.map((role) => [`${role} (junior)`, getQuestionBankForRole(role, "junior")]),
  ["generic (junior)", genericJuniorQuestionBank],
];

test("every listed role has its own bank of exactly 15 questions", () => {
  assert.deepEqual([...questionBankRoles].sort(), [...interviewRoles].sort());
  for (const [role, bank] of allBanks) {
    assert.equal(bank.length, 15, role);
    if (!role.startsWith("generic")) assert.notEqual(bank, genericQuestionBank, role);
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

test("approved job direction uses a fixed English opening and keeps the role bank intact", () => {
  const config = {
    role: "Backend Engineer", seniority: "mid-level", jobDirection: {
      targetRole: "Backend Engineer", suggestedSeniority: "mid-level", mainInterviewEmphasis: "Reliable API design",
      priorityCompetencies: ["comunicação interpessoal"], productTeamContext: "Uma equipe de pagamentos",
    },
  };
  const questions = getFixedInterviewQuestions(config);
  assert.equal(questions[0].prompt, "Based on the role description you shared, which part of your experience would be most valuable in this position?");
  assert.doesNotMatch(questions[0].prompt, /comunicação interpessoal|pagamentos/u);
  assert.match(questions[0].prompt, /role description/u);
  assert.equal(questions[0].prompt.split("?").length - 1, 1);
  assert.equal(questions[0].prompt.length <= 220, true);
  assert.deepEqual(questions.slice(1).map(({ id, prompt }) => ({ id, prompt })), getQuestionBankForRole("Backend Engineer").slice(1).map(({ id, prompt }) => ({ id, prompt })));
});

test("directed opening stays short regardless of the maximum-length Portuguese direction fields", () => {
  const questions = getFixedInterviewQuestions({
    role: "R".repeat(100), seniority: "staff", jobDirection: {
      targetRole: "R".repeat(100), suggestedSeniority: "staff", mainInterviewEmphasis: "Experiência com " + "gestão técnica ".repeat(14),
      priorityCompetencies: ["comunicação e alinhamento com partes interessadas".padEnd(100, "x")], productTeamContext: "Equipe distribuída ".repeat(14),
    },
  });
  assert.ok(questions[0].prompt.length <= 220);
  assert.doesNotMatch(questions[0].prompt, /partes interessadas|gestão técnica|Equipe distribuída/u);
  assert.equal(questions[0].prompt.split("?").length - 1, 1);
});

test("mismatched or absent approved direction preserves the generic role opening", () => {
  const expected = getFixedInterviewQuestions({ role: "Backend Engineer", seniority: "mid-level" })[0].prompt;
  assert.equal(getFixedInterviewQuestions({ role: "Backend Engineer", seniority: "mid-level", jobDirection: {
    targetRole: "Frontend Engineer", suggestedSeniority: "mid-level", mainInterviewEmphasis: "API reliability",
    priorityCompetencies: ["API reliability"], productTeamContext: "A product team",
  } })[0].prompt, expected);
});

test("role matching maps common title variants to the closest bank", () => {
  const same = (variant, role) => assert.equal(getQuestionBankForRole(variant), getQuestionBankForRole(role), variant);
  for (const variant of ["QA Analyst", "Quality Assurance Engineer", "Quality Assurance Analyst", "Test Analyst", "Test Automation Engineer", "Analista de QA", "Analista de Testes", "SDET"]) same(variant, "QA Automation Engineer");
  same("Analista de Dados", "Data Analyst");
  same("Cientista de Dados", "Data Scientist");
  same("Engenheiro de Dados", "Data Engineer");
  same("Desenvolvedor Backend", "Backend Engineer");
  same("Desenvolvedor Frontend", "Frontend Engineer");
  same("Desenvolvedor Full Stack", "Full-Stack Engineer");
  same("iOS Developer", "Mobile Engineer");
  same("Android Developer", "Mobile Engineer");
  same("Platform Engineer", "DevOps Engineer");
  same("Senior Java Developer", "Software Engineer");
  assert.equal(getQuestionBankForRole("Product Manager"), genericQuestionBank);
  assert.equal(getQuestionBankForRole("Tech Lead"), genericQuestionBank);
});

const tailored = [
  "How would you structure a Playwright test suite so it stays reliable as the product grows?",
  "How do you test REST APIs with Postman and keep the collections maintainable?",
  "How would you run automated tests in GitHub Actions without slowing down the team?",
];
const qaDirection = {
  targetRole: "QA Analyst", suggestedSeniority: "mid-level", mainInterviewEmphasis: "Automação de testes",
  priorityCompetencies: ["Automação com Playwright"], productTeamContext: "Equipe de produto", tailoredQuestions: tailored,
};

test("tailored questions replace the first technical slots and run immediately after the introduction", () => {
  const questions = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: qaDirection });
  const bank = getQuestionBankForRole("QA Analyst");
  assert.equal(questions.length, 15);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.prompt), tailored);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.id), ["job-1", "job-2", "job-3"]);
  assert.ok(questions.every((question) => question.cue.trim().length > 0));
  assert.deepEqual(questions.slice(4).map((question) => question.id), bank.slice(4).map((question) => question.id));
  assert.match(questions[0].prompt, /role description/u);
  assert.equal(new Set(questions.map((question) => question.prompt)).size, 15);
});

test("resume interviews use a resume-aware introduction and keep approved questions identifiable", () => {
  const questions = getFixedInterviewQuestions({
    role: "QA Analyst",
    seniority: "mid-level",
    interviewSource: "resume",
    jobDirection: qaDirection,
  });
  assert.match(questions[0].prompt, /introduce yourself/u);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.id), ["resume-1", "resume-2", "resume-3"]);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.prompt), tailored);
});

test("resume and vacancy interviews both fill eight source-specific planned slots", () => {
  const resumeQuestions = Array(8).fill(0).map((_, index) => `In resume project ${index + 1}, what technical decision did you make?`);
  const questions = getFixedInterviewQuestions({
    role: "QA Analyst",
    seniority: "mid-level",
    interviewSource: "resume",
    jobDirection: { ...qaDirection, tailoredQuestions: resumeQuestions },
  });
  assert.equal(questions.length, 15);
  assert.deepEqual(questions.slice(1, 9).map((question) => question.id), Array(8).fill(0).map((_, index) => `resume-${index + 1}`));
  assert.deepEqual(questions.slice(1, 9).map((question) => question.prompt), resumeQuestions);

  const vacancyQuestions = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: { ...qaDirection, tailoredQuestions: resumeQuestions } });
  assert.deepEqual(vacancyQuestions.slice(1, 9).map((question) => question.id), Array(8).fill(0).map((_, index) => `job-${index + 1}`));
  assert.deepEqual(vacancyQuestions.slice(1, 9).map((question) => question.prompt), resumeQuestions);
});

test("fewer tailored questions fill slots in order; none or a stale direction keeps the bank", () => {
  const two = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: { ...qaDirection, tailoredQuestions: tailored.slice(0, 2) } });
  assert.deepEqual([two[1].id, two[2].id, two[4].id], ["job-1", "job-2", getQuestionBankForRole("QA Analyst")[4].id]);
  const legacy = { ...qaDirection, tailoredQuestions: undefined };
  assert.equal(getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: legacy })[1].id, getQuestionBankForRole("QA Analyst")[1].id);
  const edited = getFixedInterviewQuestions({ role: "Backend Engineer", seniority: "mid-level", jobDirection: qaDirection });
  assert.equal(edited[1].id, getQuestionBankForRole("Backend Engineer")[1].id);
  const reseniored = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "senior", jobDirection: qaDirection });
  assert.equal(reseniored[1].id, getQuestionBankForRole("QA Analyst")[1].id);
  const duplicated = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: { ...qaDirection, tailoredQuestions: [tailored[0], tailored[0].toUpperCase().replace("?", "?")] } });
  assert.equal(new Set(duplicated.map((question) => question.prompt.toLowerCase())).size, 15);
});

test("junior banks have 15 unique, junior-appropriate questions per role", () => {
  const forbidden = /millions|at scale|design a (service|system)|architecture|lead (a|the) team/i;
  for (const role of [...interviewRoles, "Astronaut"]) {
    const bank = getQuestionBankForRole(role, "junior");
    assert.equal(bank.length, 15, role);
    assert.equal(new Set(bank.map((question) => question.prompt)).size, 15, role);
    assert.notEqual(bank, getQuestionBankForRole(role, "mid-level"), role);
    for (const question of bank) assert.doesNotMatch(question.prompt, forbidden, `${role}/${question.id}`);
  }
  assert.equal(getQuestionBankForRole("Astronaut", "junior"), genericJuniorQuestionBank);
  assert.equal(getQuestionBankForRole("QA Analyst", "Junior"), getQuestionBankForRole("QA Automation Engineer", "junior"));
});

test("mid-level, senior, staff, and missing seniority keep the existing banks", () => {
  for (const role of interviewRoles) {
    const base = getQuestionBankForRole(role);
    for (const seniority of ["mid-level", "senior", "staff", "", undefined, null]) assert.equal(getQuestionBankForRole(role, seniority), base, `${role}/${seniority}`);
  }
  assert.equal(getQuestionBankForRole("Astronaut", "senior"), genericQuestionBank);
  assert.equal(getFixedInterviewQuestions({ role: "Software Engineer", seniority: "senior" })[1].id, "system-design");
});

test("junior sessions never receive the system design question, and tailored questions still lead", () => {
  const junior = getFixedInterviewQuestions({ role: "Software Engineer", seniority: "junior" });
  assert.ok(junior.every((question) => !/millions/i.test(question.prompt)));
  const direction = { ...qaDirection, suggestedSeniority: "junior" };
  const questions = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "junior", jobDirection: direction });
  const bank = getQuestionBankForRole("QA Analyst", "junior");
  assert.equal(questions.length, 15);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.id), ["job-1", "job-2", "job-3"]);
  assert.deepEqual(questions.slice(4).map((question) => question.id), bank.slice(4).map((question) => question.id));
  assert.equal(new Set(questions.map((question) => question.prompt)).size, 15);
});

test("broad project questions carry coverage metadata in every bank and tailored questions never do", () => {
  for (const [name, bank] of allBanks) {
    assert.equal(bank.find((question) => question.id === "ownership").coverage, "broad-project", name);
    assert.equal(bank[0].coverage, undefined, name);
    for (const question of bank) assert.ok(question.coverage === undefined || question.coverage === "broad-project", `${name}/${question.id}`);
  }
  // Questions about one specific dimension (endpoints, screen-to-database flow, pipeline steps) are not broad.
  for (const [name, bank] of allBanks) {
    for (const question of bank) {
      if (["api-built", "full-stack-project", "devops-project"].includes(question.id)) assert.equal(question.coverage, undefined, `${name}/${question.id}`);
      if (question.id === "analysis-project" && /question you wanted to answer/.test(question.prompt)) assert.equal(question.coverage, undefined, `${name}/${question.id}`);
    }
  }
  assert.equal(getQuestionBankForRole("Software Engineer", "junior").find((question) => question.id === "project-built").coverage, "broad-project");
  assert.equal(genericJuniorQuestionBank.find((question) => question.id === "project-built").coverage, "broad-project");
  const tailored = getFixedInterviewQuestions({ role: "QA Analyst", seniority: "mid-level", jobDirection: qaDirection });
  assert.ok(tailored.filter((question) => question.id.startsWith("job-")).every((question) => question.coverage === undefined));
});
