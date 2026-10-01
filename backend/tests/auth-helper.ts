import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

export const testSupabaseUrl = "https://project.supabase.co";
export const testIssuer = `${testSupabaseUrl}/auth/v1`;

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

export function createTestKey(kid = "test-kid") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  return { kid, jwk, privateKey };
}

export type TestKey = ReturnType<typeof createTestKey>;

export function signToken(key: { kid: string; privateKey: KeyObject }, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1_000);
  const head = b64({ alg: "ES256", typ: "JWT", kid: key.kid, ...header });
  const payload = b64({ iss: testIssuer, aud: "authenticated", sub: "user-1", role: "authenticated", exp: now + 3_600, ...claims });
  const signature = sign("sha256", Buffer.from(`${head}.${payload}`), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${payload}.${signature}`;
}

export function fakeJwksFetch(getKeys: () => TestKey[]) {
  const calls = { count: 0 };
  const fetchImpl = (async () => {
    calls.count += 1;
    return new Response(JSON.stringify({ keys: getKeys().map((key) => key.jwk) }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
