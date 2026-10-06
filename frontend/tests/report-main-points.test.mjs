import assert from "node:assert/strict";
import test from "node:test";
import { deriveMainPoints, mainPointLimits, toSecondPerson } from "../src/lib/interview/report-main-points.mjs";

const item = (sequenceNumber, evidence, explanation) => ({ sequenceNumber, evidence, explanation });
const pattern = (type, sequenceNumber, evidence, suggestion = "Use a forma correta nesta frase.") => ({ type, sequenceNumber, evidence, suggestion, rephrasedExample: "Fixed." });

// Legacy shape (no new fields), modeled on a real noisy report: 8 + 8 + 8 items.
const legacy = {
  technicalContent: {
    summary: "O candidato descreveu o projeto Rancho.",
    strengths: [
      item(2, "I use the next.js for the frontend", "O candidato mencionou a tecnologia Next.js."),
      item(2, "the backend I use node.js", "O candidato mencionou Node.js."),
      item(2, "I worked in several projects", "O candidato mencionou que trabalhou em vários projetos."),
      item(3, "Gemini to answer on WhatsApp", "Você escolheu o Gemini para responder no WhatsApp com baixa latência."),
      item(3, "agents per farm", "Você separou agentes por fazenda para isolar o contexto."),
      item(4, "a", "Você explicou x."), item(4, "b", "Você explicou y."), item(4, "c", "Você explicou z."),
    ],
    gaps: [
      item(1, "They're stained. Natural language in WhatsApp.", "O candidato não explicou o treinamento."),
      item(1, "using the super base and the versal", "O candidato não explicou a hospedagem."),
      item(2, "my role in the project", "The candidate did not clearly state their specific role in the project."),
      item(3, "agents on WhatsApp", "Você não mostrou o resultado medido para os usuários."),
      item(3, "farm data", "Você não detalhou como separou os dados de fazendas."),
      item(4, "one", "Você não explicou o trade-off."), item(4, "two", "Você não explicou a escolha."), item(4, "three", "Você não explicou o prazo."),
    ],
  },
  englishCommunication: {
    clarity: "MOSTLY_CLEAR",
    evidenceStatus: "SUFFICIENT",
    patterns: [
      pattern("GRAMMAR", 2, "to facilitated their life", "O candidato deve usar o infinitivo após to."),
      pattern("WORD_CHOICE", 2, "Superbase"),
      pattern("GRAMMAR", 1, "to... to hospital all of this thing"),
      pattern("GRAMMAR", 3, "She have a project"), pattern("GRAMMAR", 3, "She have a project"),
      pattern("STRUCTURE", 4, "one"), pattern("STRUCTURE", 4, "two"), pattern("FALSE_COGNATE", 4, "three"),
    ],
  },
  priorities: [
    { area: "ENGLISH_COMMUNICATION", sequenceNumber: 2, evidence: "to facilitated their life", focus: "Infinitivo após to", exercise: "Reescreva três frases com to + verbo base." },
    { area: "TECHNICAL_CONTENT", sequenceNumber: 3, evidence: "agents on WhatsApp", focus: "Resultados medidos", exercise: "Conte um resultado com número." },
    { area: "ENGLISH_COMMUNICATION", sequenceNumber: 4, evidence: "one", focus: "Estrutura", exercise: "Responda em três frases curtas." },
    { area: "ENGLISH_COMMUNICATION", sequenceNumber: 4, evidence: "two", focus: "Quarta", exercise: "Quarta." },
  ],
};

test("legacy report main view stays within the caps and drops trivial, garbled and English items", () => {
  const main = deriveMainPoints(legacy);
  assert.ok(main.english.length <= mainPointLimits.english);
  assert.ok(main.technical.length <= mainPointLimits.technical);
  assert.ok(main.priorities.length <= mainPointLimits.priorities);
  assert.equal(main.english.some((p) => /super ?base|hospital/i.test(p.evidence)), false);
  assert.equal(main.english.filter((p) => p.evidence === "She have a project").length, 1);
  assert.equal(main.technical.some((t) => t.kind === "strength" && /mencion/i.test(t.explanation)), false);
  assert.equal(main.technical.some((t) => /candidate|stained|super/i.test(`${t.explanation} ${t.evidence}`)), false);
  assert.deepEqual(main.technical.map((t) => t.kind), ["gap", "gap", "gap"]);
});

test("legacy third person is rewritten to second person", () => {
  const main = deriveMainPoints(legacy);
  assert.equal(main.summary, "Você descreveu o projeto Rancho.");
  assert.equal(main.english[0].suggestion, "Você deve usar o infinitivo após to.");
  assert.equal(toSecondPerson("A candidata explicou."), "Você explicou.");
});

test("gaps come first and strengths fill the remaining technical slots", () => {
  const main = deriveMainPoints({
    technicalContent: { summary: "Resumo.", gaps: [item(1, "x y", "Você não mostrou o resultado.")], strengths: [item(1, "a b", "Você justificou a escolha."), item(2, "c d", "Você mediu o ganho."), item(2, "e f", "Você comparou opções.")] },
    englishCommunication: { clarity: "CLEAR", evidenceStatus: "NO_PATTERN_FOUND", patterns: [] },
    priorities: [],
  });
  assert.deepEqual(main.technical.map((t) => t.kind), ["gap", "strength", "strength"]);
  assert.deepEqual(main.english, []);
});

test("minimal or malformed legacy data does not throw", () => {
  assert.deepEqual(deriveMainPoints({}), { english: [], technical: [], priorities: [], summary: "Nesta sessão, não houve evidência técnica suficiente para gerar um resumo confiável." });
});

test("drops patterns with a wrong rule label or a request to fix a mis-heard name, and run shop evidence", () => {
  const withFix = (type, evidence, suggestion, rephrasedExample) => ({ type, sequenceNumber: 1, evidence, suggestion, rephrasedExample });
  const main = deriveMainPoints({
    technicalContent: { summary: "Resumo.", gaps: [item(1, "the run shop and Russia", "Você descreveu o sistema.")], strengths: [] },
    englishCommunication: { clarity: "MOSTLY_CLEAR", evidenceStatus: "SUFFICIENT", patterns: [
      withFix("GRAMMAR", "Russia is a full stack system", "Use os nomes corretos dos projetos.", "Run Shop is a full stack system."),
      withFix("GRAMMAR", "I choose To use the GLCM", "Ajuste a concordância verbal desta frase.", "I chose to use the GLCM."),
      withFix("GRAMMAR", "for interpret this message", "Esta é a forma correta do gerúndio.", "to interpret this message."),
      withFix("GRAMMAR", "I choose To use the GLCM", "Use o passado: o passado de choose é chose.", "I chose to use the GLCM."),
      withFix("GRAMMAR", "after deploy the fix", "Use o gerúndio depois de after.", "after deploying the fix."),
      withFix("GRAMMAR", "the servers was down", "Ajuste a concordância verbal.", "the servers were down."),
    ] },
    priorities: [],
  });
  assert.deepEqual(main.english.map((p) => p.suggestion), ["Use o passado: o passado de choose é chose.", "Use o gerúndio depois de after.", "Ajuste a concordância verbal."]);
  assert.equal(main.technical.length, 0);
});
