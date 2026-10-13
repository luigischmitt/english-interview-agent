import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { OpenRouterPracticeService, validThemeDraft, type PracticeService } from "../src/thinking/practice-service.js";
import type { TranscriptionService } from "../src/transcription/types.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000, interviewerVoice: "af_bella", defaultSpeed: 1, format: "mp3" };
const config = { openRouterApiKey: "server-test-key", model: "test-model" };
const chat = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 300, completion_tokens: 120, cost: 0.0002 } }));
const service = (value: unknown) => new OpenRouterPracticeService(config, (async () => chat(value)) as unknown as typeof fetch);
const purposeError = { type: "GRAMMAR" as const, evidence: "I used Redis for cache the sessions", suggestion: "Use to + verbo base para indicar finalidade: to cache.", rephrasedExample: "I used Redis to cache the sessions" };
const theme = { key: "purpose-to-verb", title: "Usar for antes do verbo para dizer o objetivo", explanation: "Para dizer para que algo serve, use to + verbo: I used Redis to cache sessions.", why: "Na entrevista isso deixa claro o objetivo da sua decisão.", examples: ["I used Redis to cache sessions.", "We added retries to reduce errors.", "I wrote tests to catch regressions."] };

afterEach(() => vi.restoreAllMocks());

describe("practice service", () => {
  it("groups errors into plain-language themes, sends a strict private request and logs no content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let init: RequestInit | undefined;
    const fetcher = (async (_url: string, options: RequestInit) => { init = options; return chat({ assignments: [{ index: 0, themeKey: "purpose-to-verb" }, { index: 1, themeKey: null }], newThemes: [theme] }); }) as unknown as typeof fetch;
    const result = await new OpenRouterPracticeService(config, fetcher).groupThemes({ errors: [purposeError, { ...purposeError, evidence: "uhm the the" }], existingThemes: [] });
    expect(result).toEqual({ assignments: ["purpose-to-verb", null], newThemes: [theme] });
    const body = JSON.parse(String(init?.body));
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "practice_themes", outcome: "success", errorCount: 2, assigned: 1, newThemes: 1, costUsd: 0.0002 });
    expect(line).not.toContain("Redis");
  });

  it("reuses existing themes, drops unknown keys and rewrites a technical title instead of losing the mistake", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const jargon = { ...theme, key: "article-before-singular", title: "Usar artigo antes de substantivo contável singular" };
    const responses = [
      { assignments: [{ index: 0, themeKey: "articles" }, { index: 1, themeKey: "article-before-singular" }, { index: 2, themeKey: "made-up" }], newThemes: [jargon] },
      { title: "Esquecer o 'a' antes de uma coisa só (a tool)" },
    ];
    const fetcher = (async () => chat(responses.shift())) as unknown as typeof fetch;
    const result = await new OpenRouterPracticeService(config, fetcher).groupThemes({ errors: [purposeError, purposeError, purposeError], existingThemes: [{ key: "articles", title: "Esquecer o artigo" }] });
    expect(result).toEqual({ assignments: ["articles", "article-before-singular", null], newThemes: [{ ...jargon, title: "Esquecer o 'a' antes de uma coisa só (a tool)" }] });
  });

  it("uses the person's own corrected sentences as examples of the vocabulary theme", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const words = { ...theme, key: "natural-words", title: "Trocar palavras que soam estranhas em inglês", examples: ["We use analyze to see.", "Generic one.", "Generic two."] };
    const vocab = { type: "WORD_CHOICE" as const, evidence: "all of the base", suggestion: "Use foundation para a base de um sistema.", rephrasedExample: "all of the foundation" };
    const result = await service({ assignments: [{ index: 0, themeKey: "natural-words" }], newThemes: [words] }).groupThemes({ errors: [vocab], existingThemes: [] });
    expect(result?.newThemes[0]?.examples).toEqual(["all of the foundation", "We use analyze to see.", "Generic one."]);
  });

  it("validates theme drafts: Portuguese plain text, English examples, slug key", () => {
    expect(validThemeDraft(theme)).toEqual(theme);
    expect(validThemeDraft({ ...theme, key: "Purpose To Verb" })?.key).toBe("purpose-to-verb");
    expect(validThemeDraft({ ...theme, key: "esquecer-o-a-antes-de-som-de-vogal" })?.key).toBe("esquecer-o-a-antes-de-som");
    expect(validThemeDraft({ ...theme, key: "!!!" })).toBeNull();
    expect(validThemeDraft({ ...theme, title: "Ortografia de palavras" })).toBeNull();
    expect(validThemeDraft({ ...theme, title: "Ortografia de palavras" }, { allowJargonTitle: true })).toMatchObject({ title: "Ortografia de palavras" });
    expect(validThemeDraft({ ...theme, title: "Purpose clauses", explanation: "Use to plus the base verb." })).toBeNull();
    expect(validThemeDraft({ ...theme, examples: ["Usei Redis para cache."] })).toBeNull();
  });

  it("keeps only fix exercises that quote a real user sentence", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await service({ exercises: [
      { kind: "fix", instruction: "Reescreva a sua frase dizendo para que você usou o Redis.", source: "I used Redis for cache the sessions", target: "I used Redis to cache the sessions." },
      { kind: "fix", instruction: "Corrija esta frase inventada.", source: "I used Kafka for stream the events", target: "I used Kafka to stream the events." },
      { kind: "build", instruction: "Faça uma frase em inglês dizendo que você criou testes para evitar regressões.", source: null, target: "I wrote tests to prevent regressions." },
    ] }).buildExercises({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [{ evidence: purposeError.evidence, rephrasedExample: purposeError.rephrasedExample }] });
    expect(result?.map((exercise) => exercise.kind)).toEqual(["fix", "build"]);
    expect(result?.[0]?.source).toBe(purposeError.evidence);
  });

  it("writes exercises with the exercises model and grades with the default one", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const models: string[] = [];
    const record = (async (_url: string, init: RequestInit) => { models.push(JSON.parse(String(init.body)).model); return chat({ exercises: [] }); }) as unknown as typeof fetch;
    const practice = new OpenRouterPracticeService({ ...config, exercisesModel: "openai/gpt-4.1-mini" }, record);
    await practice.buildExercises({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [] });
    await practice.grade({ theme, exercise: { kind: "build", instruction: "Faça uma frase.", source: null, target: "I did it." }, answer: "I did it", mode: "text" });
    expect(models).toEqual(["openai/gpt-4.1-mini", "test-model"]);
  });

  it("mixes own, spot and build exercises tagged with known lesson rules", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const rules = [{ id: "verb-forms.to", rule: "to + verbo: para dizer o objetivo." }];
    const result = await service({ exercises: [
      { kind: "fix", instruction: "Reescreva a sua frase dizendo para que você usou o Redis.", source: "I used Redis for cache the sessions", target: "I used Redis to cache the sessions.", ruleId: "verb-forms.to" },
      { kind: "spot", instruction: "Encontre e corrija o erro desta frase.", source: "We added a queue for process the events.", target: "We added a queue to process the events.", ruleId: "unknown.rule" },
      { kind: "spot", instruction: "Encontre e corrija o erro desta frase.", source: "We added a queue to process the events.", target: "We added a queue to process the events.", ruleId: null },
      { kind: "build", instruction: "Faça uma frase em inglês dizendo que você criou testes para evitar regressões.", source: null, target: "I wrote tests to prevent regressions.", ruleId: "verb-forms.to" },
    ] }).buildExercises({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [{ evidence: purposeError.evidence, rephrasedExample: purposeError.rephrasedExample }], rules });
    expect(result?.map((exercise) => [exercise.kind, exercise.ruleId])).toEqual([["fix", "verb-forms.to"], ["spot", null], ["build", "verb-forms.to"]]);
  });

  it("grades an answer and rejects a malformed verdict", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const exercise = { kind: "build" as const, instruction: "Faça uma frase dizendo que você usou Redis para guardar sessões.", source: null, target: "I used Redis to store sessions." };
    const grade = { themeCorrect: true, doesTask: true, otherMistake: true, feedback: "O objetivo está certo com to; só faltou o artigo antes de sessions.", corrected: "I used Redis to store the sessions." };
    await expect(service(grade).grade({ theme, exercise, answer: "I used Redis to store sessions", mode: "voice" })).resolves.toEqual({ verdict: "almost", feedback: grade.feedback, corrected: grade.corrected });
    await expect(service({ ...grade, themeCorrect: false }).grade({ theme, exercise, answer: "I used Redis for store sessions", mode: "text" })).resolves.toMatchObject({ verdict: "incorrect" });
    await expect(service({ ...grade, otherMistake: false }).grade({ theme, exercise, answer: "I used Redis to store the sessions", mode: "text" })).resolves.toMatchObject({ verdict: "correct" });
    await expect(service({ ...grade, doesTask: false }).grade({ theme, exercise, answer: "I like Docker", mode: "text" })).resolves.toMatchObject({ verdict: "incorrect", feedback: "Sua frase não faz o que o exercício pediu; releia o pedido e tente de novo." });
    await expect(service({ ...grade, doesTask: false, themeCorrect: false, feedback: "Use on com projetos, porque é aquilo em que você trabalha." }).grade({ theme, exercise, answer: "I worked at the project", mode: "text" })).resolves.toMatchObject({ verdict: "incorrect", feedback: "Use on com projetos, porque é aquilo em que você trabalha." });
    await expect(service({ ...grade, themeCorrect: false, feedback: "Use to antes do verbo: to store." }).grade({ theme, exercise, answer: "I used Redis for store sessions", mode: "text" })).resolves.toMatchObject({ verdict: "incorrect", feedback: "Use to antes do verbo: to store." });
    await expect(service({ ...grade, doesTask: "yes" }).grade({ theme, exercise, answer: "x y", mode: "text" })).resolves.toBeNull();
    await expect(service({ ...grade, feedback: "Good job, the purpose is right." }).grade({ theme, exercise, answer: "x y", mode: "text" })).resolves.toBeNull();
  });

  it("reports a provider failure as null", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const failing = new OpenRouterPracticeService(config, (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch);
    await expect(failing.grade({ theme, exercise: { kind: "build", instruction: "Faça uma frase.", source: null, target: "I did it." }, answer: "I did it", mode: "text" })).resolves.toBeNull();
  });
});

describe("practice classification", () => {
  it("keeps only known groups, falls back to the suggestion for an unusable label and logs no content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await service({ assignments: [
      { index: 0, category: "verb-forms", point: "Usar 'for' antes do verbo (o certo é 'to')" },
      { index: 1, category: "none", point: "" },
      { index: 2, category: "prepositions", point: "Wrong preposition with project" },
      { index: 9, category: "articles", point: "fora do intervalo" },
    ] }).classify({ errors: [purposeError, purposeError, purposeError] });
    expect(result).toEqual([
      { category: "verb-forms", point: "Usar 'for' antes do verbo (o certo é 'to')", ruleId: null },
      null,
      { category: "prepositions", point: "Use to + verbo base para indicar finalidade: to cache.", ruleId: null },
    ]);
    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "practice_classify", outcome: "success", errorCount: 3, assigned: 2 });
    expect(line).not.toContain("Redis");
  });

  it("maps rule ids only from the selected category and adds the optional schema field", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const rules = { "verb-forms": [{ id: "to-purpose", rule: "Use to before a verb for purpose." }], prepositions: [{ id: "on-projects", rule: "Use on with projects." }] };
    let init: RequestInit | undefined;
    const fetcher = (async (_url: string, options: RequestInit) => { init = options; return chat({ assignments: [
      { index: 0, category: "verb-forms", point: "Usar for antes do verbo", ruleId: "to-purpose" },
      { index: 1, category: "verb-forms", point: "Usar for antes do verbo", ruleId: "on-projects" },
      { index: 2, category: "articles", point: "Esquecer a", ruleId: "made-up" },
    ] }); }) as unknown as typeof fetch;
    const result = await new OpenRouterPracticeService(config, fetcher).classify({ errors: [purposeError, purposeError, purposeError], rules });
    expect(result?.map((item) => item?.ruleId)).toEqual(["to-purpose", null, null]);
    const body = JSON.parse(String(init?.body));
    expect(body.response_format.json_schema.schema.properties.assignments.items.required).toContain("ruleId");
    expect(body.messages[0].content).toContain("to-purpose: Use to before a verb for purpose.");
  });

  it("keeps the legacy schema when rules are absent and returns null rule ids", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let init: RequestInit | undefined;
    const fetcher = (async (_url: string, options: RequestInit) => { init = options; return chat({ assignments: [{ index: 0, category: "verb-forms", point: "Usar for antes do verbo" }] }); }) as unknown as typeof fetch;
    const result = await new OpenRouterPracticeService(config, fetcher).classify({ errors: [purposeError] });
    expect(result?.[0]?.ruleId).toBeNull();
    const body = JSON.parse(String(init?.body));
    expect(body.response_format.json_schema.schema.properties.assignments.items.properties).not.toHaveProperty("ruleId");
  });
});

describe("practice routes", () => {
  const exercise = { kind: "build", instruction: "Faça uma frase dizendo que você usou Redis para guardar sessões.", source: null, target: "I used Redis to store sessions." };
  const fake = (overrides: Partial<PracticeService> = {}): PracticeService => ({
    classify: vi.fn(async () => [{ category: "verb-forms" as const, point: "Usar 'for' antes do verbo (o certo é 'to')", ruleId: null }]),
    groupThemes: vi.fn(async () => ({ assignments: ["purpose-to-verb"], newThemes: [theme] })),
    buildExercises: vi.fn(async () => [exercise as never]),
    grade: vi.fn(async () => ({ verdict: "correct" as const, feedback: "Certo, você usou to para o objetivo.", corrected: "I used Redis to store sessions." })),
    ...overrides,
  });

  it("classifies errors into fixed groups", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake() });
    const response = await request(app).post("/api/v1/practice/classify").send({ errors: [purposeError] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ assignments: [{ category: "verb-forms", point: "Usar 'for' antes do verbo (o certo é 'to')", ruleId: null }] });
    expect((await request(app).post("/api/v1/practice/classify").send({ errors: [purposeError], existingThemes: [] })).status).toBe(400);
  });

  it("validates optional classify rules", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake() });
    const base = { errors: [purposeError] };
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { "verb-forms": [{ id: "to-purpose", rule: "Use to before a verb." }], prepositions: [{ id: "prepositions.on", rule: "on: dias e plataformas." }] } })).status).toBe(200);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { unknown: [] } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { articles: [{ id: "Bad id", rule: "Valid rule" }] } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { articles: Array.from({ length: 13 }, (_, i) => ({ id: `rule-${i}`, rule: "Valid rule" })) } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { articles: [{ id: "a-rule", rule: "Valid rule", extra: true }] } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { articles: [{ id: "a-rule", rule: "   " }] } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: { articles: [{ id: "a-rule", rule: "x".repeat(401) }] } })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/classify").send({ ...base, rules: [], extra: true })).status).toBe(400);
  });

  it("accepts lesson rules on exercises and rule tags on graded exercises", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake() });
    const rules = [{ id: "prepositions.on", rule: "on: dias, plataformas e aquilo em que você trabalha." }];
    expect((await request(app).post("/api/v1/practice/exercises").send({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [], rules })).status).toBe(200);
    expect((await request(app).post("/api/v1/practice/exercises").send({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [], rules: [{ id: "x", rule: "y", extra: 1 }] })).status).toBe(400);
    const graded = await request(app).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise: { kind: "spot", instruction: "Corrija.", source: "I work in the project.", target: "I work on the project.", ruleId: "prepositions.on", rule: rules[0]!.rule }, answer: "I work on the project", mode: "text" });
    expect(graded.status).toBe(200);
  });

  it("serves themes, exercises and grades", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake() });
    const themes = await request(app).post("/api/v1/practice/themes").send({ errors: [purposeError], existingThemes: [] });
    expect(themes.status).toBe(200);
    expect(themes.body).toEqual({ assignments: ["purpose-to-verb"], newThemes: [theme] });
    const exercises = await request(app).post("/api/v1/practice/exercises").send({ theme: { title: theme.title, explanation: theme.explanation, examples: theme.examples }, userErrors: [{ evidence: purposeError.evidence, rephrasedExample: purposeError.rephrasedExample }] });
    expect(exercises.body).toEqual({ exercises: [exercise] });
    const grade = await request(app).post("/api/v1/practice/grade").send({ theme: { title: theme.title, explanation: theme.explanation }, exercise, answer: "I used Redis to store sessions", mode: "text" });
    expect(grade.body).toMatchObject({ verdict: "correct" });
  });

  it("rejects invalid bodies, extra keys and oversize lists", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake() });
    expect((await request(app).post("/api/v1/practice/themes").send({ errors: [], existingThemes: [] })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/themes").send({ errors: [{ ...purposeError, extra: 1 }], existingThemes: [] })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/themes").send({ errors: Array.from({ length: 21 }, () => purposeError), existingThemes: [] })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise, answer: "x".repeat(501), mode: "text" })).status).toBe(400);
    expect((await request(app).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise, answer: "ok", mode: "audio" })).status).toBe(400);
  });

  it("returns 503 without a service, 502 on failure and 429 while a call is in flight", async () => {
    expect((await request(createApp({ speechConfig, accessTokenVerifier: null, practiceService: null })).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise, answer: "ok", mode: "text" })).status).toBe(503);
    expect((await request(createApp({ speechConfig, accessTokenVerifier: null, practiceService: fake({ grade: async () => null }) })).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise, answer: "ok", mode: "text" })).status).toBe(502);
    let finish!: () => void;
    const slow = fake({ grade: () => new Promise((resolve) => { finish = () => resolve({ verdict: "correct", feedback: "Certo.", corrected: "Ok." }); }) });
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: slow });
    const body = { theme: { title: "t", explanation: "e" }, exercise, answer: "ok", mode: "text" };
    const first = request(app).post("/api/v1/practice/grade").send(body).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await request(app).post("/api/v1/practice/grade").send(body);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("1");
    finish();
    expect((await first).status).toBe(200);
  });
});

describe("practice limits", () => {
  it("lets grading run while a slow theme grouping is in flight for the same user", async () => {
    let finish!: () => void;
    const service: PracticeService = {
      classify: vi.fn(async () => null),
      groupThemes: () => new Promise((resolve) => { finish = () => resolve({ assignments: [null], newThemes: [] }); }),
      buildExercises: vi.fn(async () => null),
      grade: vi.fn(async () => ({ verdict: "correct" as const, feedback: "Certo.", corrected: "Ok." })),
    };
    const app = createApp({ speechConfig, accessTokenVerifier: null, practiceService: service });
    const themes = request(app).post("/api/v1/practice/themes").send({ errors: [purposeError], existingThemes: [] }).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const grade = await request(app).post("/api/v1/practice/grade").send({ theme: { title: "t", explanation: "e" }, exercise: { kind: "build", instruction: "Faça uma frase.", source: null, target: "I did it." }, answer: "ok", mode: "text" });
    expect(grade.status).toBe(200);
    finish();
    expect((await themes).status).toBe(200);
  });
});

describe("practice voice transcription", () => {
  it.each([["audio/webm;codecs=opus", "webm"], ["audio/mp4", "mp4"], ["audio/wav", "wav"]])("accepts %s recordings", async (contentType, format) => {
    const transcribe = vi.fn<TranscriptionService["transcribe"]>(async (_audio, provider) => ({ provider, transcript: "I used Redis to cache sessions." }));
    const app = createApp({ speechConfig, accessTokenVerifier: null, transcriptionService: { availableProviders: () => ["whisper-large-v3-turbo"], transcribe } });
    const response = await request(app).post("/api/v1/transcriptions").set("content-type", contentType).set("x-transcription-provider", "whisper-large-v3-turbo").send(Buffer.from("audio bytes"));
    expect(response.status).toBe(200);
    expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), "whisper-large-v3-turbo", format);
  });
});
