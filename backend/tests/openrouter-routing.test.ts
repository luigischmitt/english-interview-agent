import { describe, expect, it } from "vitest";

import { createPinnedOpenRouterFetch, pinnedProviderFromEnvironment } from "../src/thinking/openrouter-routing.js";

const url = "https://openrouter.ai/api/v1/chat/completions";
const original = { model: "m", messages: [], provider: { sort: "latency", require_parameters: true, data_collection: "deny" } };

function recorder(statuses: Array<number | Error>) {
  const bodies: Array<Record<string, any>> = [];
  const base: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = statuses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response("{}", { status: next });
  };
  return { bodies, base };
}

describe("Parasail-first routing", () => {
  it("sends chat calls to the pinned provider only, keeping the privacy rules", async () => {
    const { bodies, base } = recorder([200]);
    const response = await createPinnedOpenRouterFetch("parasail", base)(url, { method: "POST", body: JSON.stringify(original) });
    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].provider).toEqual({ require_parameters: true, data_collection: "deny", only: ["parasail"], allow_fallbacks: false });
  });

  it.each([429, 503, 404])("falls back once to the original routing when the pin answers %i", async (status) => {
    const { bodies, base } = recorder([status, 200]);
    const response = await createPinnedOpenRouterFetch("parasail", base)(url, { method: "POST", body: JSON.stringify(original) });
    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(original);
  });

  it("falls back on a network error but not on the caller's abort", async () => {
    const network = recorder([new TypeError("fetch failed"), 200]);
    await expect(createPinnedOpenRouterFetch("parasail", network.base)(url, { method: "POST", body: JSON.stringify(original) })).resolves.toHaveProperty("status", 200);
    expect(network.bodies).toHaveLength(2);
    const controller = new AbortController();
    controller.abort();
    const aborted = recorder([new DOMException("aborted", "AbortError")]);
    await expect(createPinnedOpenRouterFetch("parasail", aborted.base)(url, { method: "POST", body: JSON.stringify(original), signal: controller.signal })).rejects.toThrow();
    expect(aborted.bodies).toHaveLength(1);
  });

  it("keeps a request that already ignores the pinned provider, and other endpoints, untouched", async () => {
    const ignoring = { ...original, provider: { ...original.provider, ignore: ["Parasail"] } };
    const { bodies, base } = recorder([200, 200]);
    await createPinnedOpenRouterFetch("parasail", base)(url, { method: "POST", body: JSON.stringify(ignoring) });
    await createPinnedOpenRouterFetch("parasail", base)("https://openrouter.ai/api/v1/audio/transcriptions", { method: "POST", body: JSON.stringify(original) });
    expect(bodies).toEqual([ignoring, original]);
  });

  it("reads the pin from the environment and can be turned off", () => {
    expect(pinnedProviderFromEnvironment({})).toBe("parasail");
    expect(pinnedProviderFromEnvironment({ OPENROUTER_PINNED_PROVIDER: "off" })).toBeNull();
    expect(pinnedProviderFromEnvironment({ OPENROUTER_PINNED_PROVIDER: "deepinfra" })).toBe("deepinfra");
  });
});
