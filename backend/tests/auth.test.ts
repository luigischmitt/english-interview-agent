import { createServer } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { createApp } from "../src/app.js";
import { createAccessTokenVerifier } from "../src/auth/access-token-verifier.js";
import { loadAuthConfig } from "../src/auth/config.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { attachTranscriptionWebSocket } from "../src/transcription/transcription-websocket.js";
import type { TranscriptionService } from "../src/transcription/types.js";
import { createTestKey, fakeJwksFetch, signToken, testSupabaseUrl } from "./auth-helper.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8880", kokoroTimeoutMs: 15_000, interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3" };
const key = createTestKey();
const now = () => Math.floor(Date.now() / 1_000);

function verifierFor(keys = [key], extra: Partial<Parameters<typeof createAccessTokenVerifier>[0]> = {}) {
  const jwks = fakeJwksFetch(() => keys);
  return { verifier: createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: jwks.fetchImpl, ...extra }), jwks };
}

const rejectsWith = async (promise: Promise<unknown>, reason: string) => {
  await expect(promise).rejects.toMatchObject({ reason });
};

afterEach(() => vi.restoreAllMocks());

describe("access token verification", () => {
  it("accepts a valid token and returns the user id", async () => {
    const { verifier } = verifierFor();
    await expect(verifier.verify(signToken(key))).resolves.toEqual({ userId: "user-1" });
  });

  it("accepts an audience array containing authenticated", async () => {
    const { verifier } = verifierFor();
    await expect(verifier.verify(signToken(key, { aud: ["other", "authenticated"] }))).resolves.toBeDefined();
  });

  it("rejects missing and malformed tokens", async () => {
    const { verifier } = verifierFor();
    await rejectsWith(verifier.verify(undefined), "missing");
    await rejectsWith(verifier.verify("not-a-jwt"), "malformed");
    await rejectsWith(verifier.verify("a.b.c"), "malformed");
  });

  it("rejects expired tokens beyond the clock skew but tolerates a few seconds", async () => {
    const { verifier } = verifierFor();
    await rejectsWith(verifier.verify(signToken(key, { exp: now() - 120 })), "expired");
    await expect(verifier.verify(signToken(key, { exp: now() - 5 }))).resolves.toBeDefined();
  });

  it("rejects tokens that are not yet valid", async () => {
    const { verifier } = verifierFor();
    await rejectsWith(verifier.verify(signToken(key, { nbf: now() + 600 })), "expired");
  });

  it("rejects wrong issuer, wrong audience and missing subject", async () => {
    const { verifier } = verifierFor();
    await rejectsWith(verifier.verify(signToken(key, { iss: "https://evil.example/auth/v1" })), "wrong_issuer");
    await rejectsWith(verifier.verify(signToken(key, { aud: "anon" })), "wrong_audience");
    await rejectsWith(verifier.verify(signToken(key, { sub: undefined })), "malformed");
  });

  it("rejects alg none and HS256 tokens", async () => {
    const { verifier } = verifierFor();
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const claims = b64({ iss: `${testSupabaseUrl}/auth/v1`, aud: "authenticated", sub: "u", exp: now() + 600 });
    await rejectsWith(verifier.verify(`${b64({ alg: "none", kid: key.kid })}.${claims}.`), "malformed");
    await rejectsWith(verifier.verify(`${b64({ alg: "HS256", kid: key.kid })}.${claims}.${b64("sig")}`), "malformed");
  });

  it("rejects a tampered signature or payload", async () => {
    const { verifier } = verifierFor();
    const [head, payload, signature] = signToken(key).split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ iss: `${testSupabaseUrl}/auth/v1`, aud: "authenticated", sub: "admin", exp: now() + 600 })).toString("base64url");
    await rejectsWith(verifier.verify(`${head}.${forged}.${signature}`), "bad_signature");
    await rejectsWith(verifier.verify(`${head}.${payload}.${signature.slice(0, -4)}AAAA`), "bad_signature");
  });

  it("rejects a token signed by another key under a known kid", async () => {
    const { verifier } = verifierFor();
    const other = createTestKey(key.kid);
    await rejectsWith(verifier.verify(signToken(other)), "bad_signature");
  });

  it("refetches the JWKS once for an unknown kid and accepts a rotated key", async () => {
    const keys = [key];
    const jwks = fakeJwksFetch(() => keys);
    const verifier = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: jwks.fetchImpl, minRefetchIntervalMs: 0 });
    await verifier.verify(signToken(key));
    expect(jwks.calls.count).toBe(1);
    const rotated = createTestKey("rotated");
    keys.push(rotated);
    await expect(verifier.verify(signToken(rotated))).resolves.toBeDefined();
    expect(jwks.calls.count).toBe(2);
    await rejectsWith(verifier.verify(signToken(createTestKey("ghost"))), "unknown_kid");
    expect(jwks.calls.count).toBe(3);
  });

  it("does not hammer the JWKS endpoint for unknown kids", async () => {
    const { verifier, jwks } = verifierFor([key], { minRefetchIntervalMs: 60_000 });
    await verifier.verify(signToken(key));
    for (let i = 0; i < 5; i += 1) await rejectsWith(verifier.verify(signToken(createTestKey(`ghost-${i}`))), "unknown_kid");
    expect(jwks.calls.count).toBe(1);
  });

  it("caches the JWKS across verifications", async () => {
    const { verifier, jwks } = verifierFor();
    await verifier.verify(signToken(key));
    await verifier.verify(signToken(key));
    expect(jwks.calls.count).toBe(1);
  });

  it("keeps the last good keys when a stale JWKS refresh fails", async () => {
    let clock = 1_000_000;
    let failing = false;
    const good = fakeJwksFetch(() => [key]);
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => failing ? new Response("down", { status: 503 }) : good.fetchImpl(...args)) as typeof fetch;
    const verifier = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl, now: () => clock, jwksTtlMs: 1_000 });
    const token = () => signToken(key, { exp: clock / 1_000 + 3_600 });
    await verifier.verify(token());
    failing = true;
    clock += 5_000;
    await expect(verifier.verify(token())).resolves.toMatchObject({ userId: expect.any(String) });
  });

  it("reports jwks_unavailable when the key set cannot be fetched", async () => {
    const verifier = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: (async () => new Response("nope", { status: 500 })) as typeof fetch });
    await expect(verifier.verify(signToken(key))).rejects.toMatchObject({ reason: "jwks_unavailable", status: 503 });
  });
});

describe("auth configuration", () => {
  it("requires SUPABASE_URL while authentication is required", () => {
    expect(() => loadAuthConfig({})).toThrow(/SUPABASE_URL is required/);
  });

  it("accepts https and local http URLs and rejects other http URLs", () => {
    expect(loadAuthConfig({ SUPABASE_URL: "https://p.supabase.co/" })).toEqual({ required: true, supabaseUrl: "https://p.supabase.co" });
    expect(loadAuthConfig({ SUPABASE_URL: "http://127.0.0.1:54321" }).supabaseUrl).toBe("http://127.0.0.1:54321");
    expect(() => loadAuthConfig({ SUPABASE_URL: "http://example.com" })).toThrow(/https/);
    expect(() => loadAuthConfig({ SUPABASE_URL: "nonsense" })).toThrow(/valid URL/);
  });

  it("allows disabling authentication explicitly and rejects unknown values", () => {
    expect(loadAuthConfig({ BACKEND_AUTH_REQUIRED: "false" })).toEqual({ required: false, supabaseUrl: null });
    expect(() => loadAuthConfig({ BACKEND_AUTH_REQUIRED: "0", SUPABASE_URL: "https://p.supabase.co" })).toThrow(/BACKEND_AUTH_REQUIRED/);
  });
});

describe("authenticated HTTP routes", () => {
  const { verifier } = verifierFor();
  const protectedApp = () => createApp({ speechConfig, accessTokenVerifier: verifier, thinkingService: null, reportService: null });

  it.each([
    ["post", "/api/v1/speech"],
    ["post", "/api/v1/speech/warmup"],
    ["get", "/api/v1/speech/voices"],
    ["get", "/api/v1/speech/warmup-status"],
    ["post", "/api/v1/thinking"],
    ["post", "/api/v1/thinking/next-turn"],
    ["post", "/api/v1/thinking/report"],
    ["post", "/api/v1/thinking/report/turn"],
    ["post", "/api/v1/thinking/report/consolidate"],
    ["post", "/api/v1/transcriptions"],
    ["get", "/api/v1/transcriptions/providers"],
    ["post", "/api/v1/formulations"],
  ] as const)("returns 401 for %s %s without a token", async (method, path) => {
    const response = await request(protectedApp())[method](path).set("origin", "http://localhost:3000").send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." } });
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("returns 401 for invalid tokens and never logs the token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const bad = signToken(key, { exp: now() - 600 });
    const response = await request(protectedApp()).post("/api/v1/speech").set("authorization", `Bearer ${bad}`).send({ text: "hi" });
    expect(response.status).toBe(401);
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain('"event":"auth_rejected"');
    expect(logged).toContain('"reason":"expired"');
    expect(logged).not.toContain(bad);
    expect(logged).not.toContain("user-1");
  });

  it("lets a valid token reach the route", async () => {
    const response = await request(protectedApp()).get("/api/v1/speech/voices").set("authorization", `Bearer ${signToken(key)}`);
    expect(response.status).not.toBe(401);
  });

  it("keeps the health routes open", async () => {
    const app = protectedApp();
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/api/v1/speech/health")).status).toBe(200);
  });

  it("answers CORS preflight without a token", async () => {
    const response = await request(protectedApp()).options("/api/v1/speech").set("origin", "http://localhost:3000").set("access-control-request-method", "POST").set("access-control-request-headers", "authorization,content-type");
    expect(response.status).toBeLessThan(300);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("returns a generic 503 when the JWKS is unavailable", async () => {
    const down = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: (async () => { throw new Error("secret detail"); }) as typeof fetch });
    const app = createApp({ speechConfig, accessTokenVerifier: down });
    const response = await request(app).get("/api/v1/speech/voices").set("authorization", `Bearer ${signToken(key)}`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });

  it("skips authentication when it is disabled", async () => {
    const app = createApp({ speechConfig, accessTokenVerifier: null });
    const response = await request(app).get("/api/v1/speech/voices");
    expect(response.status).not.toBe(401);
  });
});

describe("authenticated transcription WebSocket", () => {
  const start = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: "start", version: 2, sampleRate: 16_000, channels: 1, encoding: "s16le", speechThreshold: 0.025, ...extra });

  async function open(startTimeoutMs?: number) {
    const transcribe = vi.fn();
    const service: TranscriptionService = { availableProviders: () => ["whisper-large-v3-turbo"], transcribe };
    const { verifier } = verifierFor();
    const server = createServer();
    attachTranscriptionWebSocket(server, service, null, undefined, null, { verifier, startTimeoutMs });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/transcriptions/stream`);
    const messages: Array<Record<string, any>> = [];
    socket.on("message", (raw, isBinary) => { if (!isBinary) messages.push(JSON.parse(raw.toString())); });
    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    return { socket, messages, closed, transcribe, cleanup: () => new Promise<void>((resolve) => { socket.terminate(); server.close(() => resolve()); }) };
  }

  it("accepts a start with a valid token", async () => {
    const ctx = await open();
    ctx.socket.send(start({ accessToken: signToken(key) }));
    await vi.waitFor(() => expect(ctx.messages.some((message) => message.type === "ready")).toBe(true));
    await ctx.cleanup();
  });

  it.each([
    ["no token", {}],
    ["an invalid token", { accessToken: "garbage" }],
    ["an expired token", { accessToken: signToken(key, { exp: now() - 600 }) }],
    ["a non-string token", { accessToken: 42 }],
  ])("rejects a start with %s and creates no session", async (_name, extra) => {
    const ctx = await open();
    ctx.socket.send(start(extra));
    expect(await ctx.closed).toBe(1008);
    expect(ctx.messages).toEqual([{ type: "error", code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." }]);
    expect(ctx.transcribe).not.toHaveBeenCalled();
    await ctx.cleanup();
  });

  it("rejects audio sent before an authenticated start", async () => {
    const ctx = await open();
    ctx.socket.send(Buffer.alloc(3_200));
    expect(await ctx.closed).toBe(1008);
    expect(ctx.messages.map((message) => message.code)).toEqual(["UNAUTHENTICATED"]);
    await ctx.cleanup();
  });

  it("closes an unauthenticated socket after the start timeout", async () => {
    const ctx = await open(80);
    expect(await ctx.closed).toBe(1008);
    expect(ctx.messages.map((message) => message.code)).toEqual(["UNAUTHENTICATED"]);
    await ctx.cleanup();
  });
});

describe("remote token check fallback", () => {
  const pk = "sb_publishable_test";
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const hs256 = (claims: Record<string, unknown> = {}, alg = "HS256") =>
    `${b64({ alg, typ: "JWT" })}.${b64({ iss: `${testSupabaseUrl}/auth/v1`, aud: "authenticated", sub: "u", exp: now() + 600, ...claims })}.${b64("sig")}`;

  function remoteVerifier(respond: (url: string, init: RequestInit) => Response | Promise<Response>, extra: Partial<Parameters<typeof createAccessTokenVerifier>[0]> = {}) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const jwks = fakeJwksFetch(() => [key]);
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/jwks.json")) return jwks.fetchImpl(url, init);
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch;
    return { calls, verifier: createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl, publishableKey: pk, ...extra }) };
  }
  const ok = () => new Response(JSON.stringify({ id: "remote-user" }), { status: 200 });

  it("accepts an HS256 token through Supabase and caches the result", async () => {
    const { verifier, calls } = remoteVerifier(ok);
    const token = hs256();
    await expect(verifier.verify(token)).resolves.toEqual({ userId: "remote-user" });
    await expect(verifier.verify(token)).resolves.toEqual({ userId: "remote-user" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${testSupabaseUrl}/auth/v1/user`);
    expect(calls[0]!.init.headers).toMatchObject({ apikey: pk, authorization: `Bearer ${token}` });
  });

  it("shares one in-flight request between identical concurrent tokens", async () => {
    const { verifier, calls } = remoteVerifier(async () => { await new Promise((r) => setTimeout(r, 10)); return ok(); });
    const token = hs256();
    await Promise.all([verifier.verify(token), verifier.verify(token)]);
    expect(calls).toHaveLength(1);
  });

  it("does not cache failures", async () => {
    let status = 500;
    const { verifier, calls } = remoteVerifier(() => (status === 200 ? ok() : new Response("x", { status })));
    const token = hs256();
    await rejectsWith(verifier.verify(token), "jwks_unavailable");
    status = 200;
    await expect(verifier.verify(token)).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it("evicts the oldest cache entry when the cache is full", async () => {
    const { verifier, calls } = remoteVerifier(ok, { remoteCacheMaxEntries: 1 });
    const a = hs256({ sub: "a" });
    const b = hs256({ sub: "b" });
    await verifier.verify(a);
    await verifier.verify(b);
    await verifier.verify(a);
    expect(calls).toHaveLength(3);
  });

  it("maps remote 401/403 to a 401 and 5xx or timeouts to 503", async () => {
    for (const status of [401, 403]) {
      const { verifier } = remoteVerifier(() => new Response("no", { status }));
      await expect(verifier.verify(hs256())).rejects.toMatchObject({ reason: "rejected_by_supabase", status: 401 });
    }
    const { verifier: failing } = remoteVerifier(() => new Response("boom", { status: 500 }));
    await expect(failing.verify(hs256())).rejects.toMatchObject({ reason: "jwks_unavailable", status: 503 });
    const { verifier: slow } = remoteVerifier((_url, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))), { remoteTimeoutMs: 20 });
    await expect(slow.verify(hs256())).rejects.toMatchObject({ reason: "jwks_unavailable", status: 503 });
  });

  it("falls back to Supabase for an unknown kid", async () => {
    const { verifier, calls } = remoteVerifier(ok, { minRefetchIntervalMs: 0 });
    const other = createTestKey("other-kid");
    await expect(verifier.verify(signToken(other))).resolves.toEqual({ userId: "remote-user" });
    expect(calls).toHaveLength(1);
  });

  it("never sends alg none remotely", async () => {
    const { verifier, calls } = remoteVerifier(ok);
    await rejectsWith(verifier.verify(`${b64({ alg: "none" })}.${b64({ iss: `${testSupabaseUrl}/auth/v1`, exp: now() + 600 })}.${b64("sig")}`), "malformed");
    await rejectsWith(verifier.verify(`${b64({ alg: "none" })}.${b64({ exp: now() + 600 })}.`), "malformed");
    expect(calls).toHaveLength(0);
  });

  it("rejects expired, wrong-issuer and wrong-audience tokens without calling Supabase", async () => {
    const { verifier, calls } = remoteVerifier(ok);
    await rejectsWith(verifier.verify(hs256({ exp: now() - 120 })), "expired");
    await rejectsWith(verifier.verify(hs256({ iss: "https://evil.example/auth/v1" })), "wrong_issuer");
    await rejectsWith(verifier.verify(hs256({ aud: "anon" })), "wrong_audience");
    expect(calls).toHaveLength(0);
  });

  it("is disabled without a publishable key", async () => {
    const calls: string[] = [];
    const verifier = createAccessTokenVerifier({ supabaseUrl: testSupabaseUrl, fetchImpl: (async (url: string) => { calls.push(url); return ok(); }) as typeof fetch });
    await rejectsWith(verifier.verify(hs256()), "malformed");
    expect(calls).toHaveLength(0);
  });

  it("logs only content-free outcomes and never the token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { verifier } = remoteVerifier(ok);
    const token = hs256();
    await verifier.verify(token);
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain('"event":"auth_remote_check"');
    expect(logged).toContain('"outcome":"accepted"');
    expect(logged).toContain('"trigger":"non_es256"');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("remote-user");
  });

  it("reads SUPABASE_PUBLISHABLE_KEY as optional config", () => {
    expect(loadAuthConfig({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_PUBLISHABLE_KEY: " k " }).publishableKey).toBe("k");
    expect(loadAuthConfig({ SUPABASE_URL: "https://p.supabase.co" }).publishableKey).toBeUndefined();
  });
});
