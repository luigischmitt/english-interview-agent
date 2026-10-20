import assert from "node:assert/strict";
import test from "node:test";
import { requestPersistedReport } from "../src/lib/interview/persisted-report-request.mjs";

test("posts only the persisted interview id, locale and voice summary to the authenticated endpoint", async () => {
  let request;
  const report = { technicalContent: { summary: "Ready" } };
  const result = await requestPersistedReport("interview/id", { accuracy: { mean: 80, sampleCount: 1 } }, "en", async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ status: "ready", report }), { status: 200 });
  }, "https://api.example.test");

  assert.deepEqual(result, report);
  assert.equal(request.url, "https://api.example.test/api/v1/thinking/report/interview/interview%2Fid");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), { locale: "en", azureSummary: { accuracy: { mean: 80, sampleCount: 1 } } });
});

test("surfaces the retryable server error copy", async () => {
  await assert.rejects(
    requestPersistedReport("id", null, "pt-BR", async () => new Response(JSON.stringify({ error: { message: "Tente em instantes." } }), { status: 502 }), "https://api.example.test"),
    /Tente em instantes\./,
  );
});
