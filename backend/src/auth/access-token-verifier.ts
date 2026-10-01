import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

export type AuthRejectReason = "missing" | "malformed" | "bad_signature" | "expired" | "wrong_issuer" | "wrong_audience" | "unknown_kid" | "rejected_by_supabase" | "jwks_unavailable";

export class AuthError extends Error {
  constructor(readonly reason: AuthRejectReason) {
    super(`Authentication failed: ${reason}`);
    this.name = "AuthError";
  }

  /** JWKS or Supabase Auth outages (reason jwks_unavailable) are a server-side problem, everything else is a rejected credential. */
  get status(): 401 | 503 {
    return this.reason === "jwks_unavailable" ? 503 : 401;
  }
}

/** The user id stays internal; it must never be logged. */
export type AuthenticatedUser = { userId: string };

export type AccessTokenVerifier = {
  verify(token: string | null | undefined): Promise<AuthenticatedUser>;
};

export type AccessTokenVerifierOptions = {
  supabaseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  jwksTtlMs?: number;
  /** Minimum spacing between JWKS refetches triggered by unknown key ids. */
  minRefetchIntervalMs?: number;
  fetchTimeoutMs?: number;
  clockSkewSeconds?: number;
  /** Public (publishable) key; enables the remote fallback through GET /auth/v1/user. Absent: fallback disabled. */
  publishableKey?: string | null;
  remoteTimeoutMs?: number;
  remoteCacheMaxMs?: number;
  remoteCacheMaxEntries?: number;
};

type RemoteTrigger = "non_es256" | "unknown_kid";
type RemoteOutcome = "accepted" | "rejected" | "unavailable";

function logRemoteCheck(outcome: RemoteOutcome, trigger: RemoteTrigger): void {
  console.info(JSON.stringify({ event: "auth_remote_check", outcome, trigger }));
}

const maxTokenLength = 4096;
const maxClockSkewSeconds = 30;
const base64Url = /^[A-Za-z0-9_-]+$/u;

function decodeSegment(segment: string): Buffer {
  if (!base64Url.test(segment)) throw new AuthError("malformed");
  return Buffer.from(segment, "base64url");
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(decodeSegment(segment).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthError("malformed");
    return value as Record<string, unknown>;
  } catch (error) {
    throw error instanceof AuthError ? error : new AuthError("malformed");
  }
}

export function createAccessTokenVerifier(options: AccessTokenVerifierOptions): AccessTokenVerifier {
  const baseUrl = options.supabaseUrl.replace(/\/+$/, "");
  const issuer = `${baseUrl}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const ttlMs = options.jwksTtlMs ?? 10 * 60_000;
  const minRefetchMs = options.minRefetchIntervalMs ?? 30_000;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 5_000;
  const skewSeconds = Math.min(options.clockSkewSeconds ?? maxClockSkewSeconds, maxClockSkewSeconds);

  const publishableKey = options.publishableKey?.trim() || null;
  const remoteTimeoutMs = options.remoteTimeoutMs ?? 3_000;
  const remoteCacheMaxMs = options.remoteCacheMaxMs ?? 10 * 60_000;
  const remoteCacheMaxEntries = options.remoteCacheMaxEntries ?? 500;
  const userUrl = `${issuer}/user`;
  /** sha256(token) -> expiry in ms. The raw token is never stored. Map keeps insertion order, so the first key is the oldest. */
  const remoteCache = new Map<string, { userId: string; expiresAtMs: number }>();
  const remoteInFlight = new Map<string, Promise<AuthenticatedUser>>();

  let keys = new Map<string, KeyObject>();
  let fetchedAt: number | null = null;
  let lastAttemptAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    lastAttemptAt = now();
    inFlight = (async () => {
      try {
        const response = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(fetchTimeoutMs), headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("jwks status");
        const body = await response.json() as { keys?: unknown };
        if (!Array.isArray(body.keys)) throw new Error("jwks shape");
        const next = new Map<string, KeyObject>();
        for (const candidate of body.keys as Array<Record<string, unknown>>) {
          if (typeof candidate?.kid !== "string" || candidate.kty !== "EC" || candidate.crv !== "P-256") continue;
          if (candidate.alg !== undefined && candidate.alg !== "ES256") continue;
          try {
            next.set(candidate.kid, createPublicKey({ key: candidate as JsonWebKey, format: "jwk" }));
          } catch {
            // Skip keys Node cannot import.
          }
        }
        keys = next;
        fetchedAt = now();
      } catch {
        throw new AuthError("jwks_unavailable");
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const getKey = async (kid: string): Promise<KeyObject> => {
    const stale = fetchedAt === null || now() - fetchedAt >= ttlMs;
    if (stale) {
      try {
        await refresh();
      } catch (error) {
        // A Supabase blip must not lock everyone out: keep verifying with the last good keys.
        if (keys.size === 0) throw error;
      }
    }
    let key = keys.get(kid);
    if (key) return key;
    const mayRefetch = !stale && (lastAttemptAt === null || now() - lastAttemptAt >= minRefetchMs);
    if (mayRefetch) {
      await refresh();
      key = keys.get(kid);
      if (key) return key;
    }
    throw new AuthError("unknown_kid");
  };

  /** Cheap unverified checks so obviously bad tokens never reach Supabase. */
  const precheckClaims = (claims: Record<string, unknown>): number => {
    const nowSeconds = now() / 1_000;
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) throw new AuthError("malformed");
    if (claims.exp + skewSeconds <= nowSeconds) throw new AuthError("expired");
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - skewSeconds > nowSeconds)) throw new AuthError(typeof claims.nbf === "number" ? "expired" : "malformed");
    if (claims.iss !== issuer) throw new AuthError("wrong_issuer");
    const audience = claims.aud;
    if (!(audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated")))) throw new AuthError("wrong_audience");
    return claims.exp;
  };

  const callSupabaseUser = async (token: string, trigger: RemoteTrigger, key: string): Promise<AuthenticatedUser> => {
    let response: Response;
    try {
      response = await fetchImpl(userUrl, { signal: AbortSignal.timeout(remoteTimeoutMs), headers: { accept: "application/json", apikey: key, authorization: `Bearer ${token}` } });
    } catch {
      logRemoteCheck("unavailable", trigger);
      throw new AuthError("jwks_unavailable");
    }
    if (response.status === 401 || response.status === 403) {
      logRemoteCheck("rejected", trigger);
      throw new AuthError("rejected_by_supabase");
    }
    let id: unknown;
    if (response.status === 200) {
      try {
        id = ((await response.json()) as { id?: unknown } | null)?.id;
      } catch {
        id = undefined;
      }
    }
    if (typeof id !== "string" || id === "") {
      logRemoteCheck("unavailable", trigger);
      throw new AuthError("jwks_unavailable");
    }
    logRemoteCheck("accepted", trigger);
    return { userId: id };
  };

  const verifyRemotely = async (token: string, claims: Record<string, unknown>, trigger: RemoteTrigger, key: string): Promise<AuthenticatedUser> => {
    const exp = precheckClaims(claims);
    const digest = createHash("sha256").update(token).digest("hex");
    const cached = remoteCache.get(digest);
    if (cached) {
      if (cached.expiresAtMs > now()) return { userId: cached.userId };
      remoteCache.delete(digest);
    }
    const pending = remoteInFlight.get(digest);
    if (pending) return pending;
    const request = callSupabaseUser(token, trigger, key).then((user) => {
      remoteCache.set(digest, { userId: user.userId, expiresAtMs: Math.min(exp * 1_000, now() + remoteCacheMaxMs) });
      while (remoteCache.size > remoteCacheMaxEntries) remoteCache.delete(remoteCache.keys().next().value as string);
      return user;
    }).finally(() => remoteInFlight.delete(digest));
    remoteInFlight.set(digest, request);
    return request;
  };

  return {
    async verify(token) {
      if (!token) throw new AuthError("missing");
      if (token.length > maxTokenLength) throw new AuthError("malformed");
      const parts = token.split(".");
      if (parts.length !== 3) throw new AuthError("malformed");
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      const header = decodeJson(headerPart);
      if (typeof header.alg !== "string" || header.alg === "" || header.alg.toLowerCase() === "none") throw new AuthError("malformed");
      const claims = decodeJson(payloadPart);
      const signature = decodeSegment(signaturePart);
      if (header.alg !== "ES256") {
        if (!publishableKey) throw new AuthError("malformed");
        return verifyRemotely(token, claims, "non_es256", publishableKey);
      }
      if (typeof header.kid !== "string" || header.kid === "") throw new AuthError("malformed");

      let key: KeyObject;
      try {
        key = await getKey(header.kid);
      } catch (error) {
        if (publishableKey && error instanceof AuthError && error.reason === "unknown_kid") return verifyRemotely(token, claims, "unknown_kid", publishableKey);
        throw error;
      }
      const valid = signature.length === 64 && verifySignature("sha256", Buffer.from(`${headerPart}.${payloadPart}`), { key, dsaEncoding: "ieee-p1363" }, signature);
      if (!valid) throw new AuthError("bad_signature");

      const nowSeconds = now() / 1_000;
      if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) throw new AuthError("malformed");
      if (claims.exp + skewSeconds <= nowSeconds) throw new AuthError("expired");
      if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf - skewSeconds > nowSeconds)) throw new AuthError(typeof claims.nbf === "number" ? "expired" : "malformed");
      if (claims.iss !== issuer) throw new AuthError("wrong_issuer");
      const audience = claims.aud;
      if (!(audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated")))) throw new AuthError("wrong_audience");
      if (typeof claims.sub !== "string" || claims.sub === "") throw new AuthError("malformed");
      return { userId: claims.sub };
    },
  };
}

/** Content-free log line: never the token, user, or provider detail. */
export function logAuthRejected(where: { route: string } | { channel: string }, reason: AuthRejectReason): void {
  const location = "route" in where ? { route: where.route.slice(0, 80) } : where;
  console.info(JSON.stringify({ event: "auth_rejected", ...location, reason }));
}

let disabledWarningLogged = false;

export function warnAuthDisabledOnce(): void {
  if (disabledWarningLogged) return;
  disabledWarningLogged = true;
  console.warn(JSON.stringify({ event: "auth_disabled", message: "BACKEND_AUTH_REQUIRED=false: backend calls are NOT authenticated. Use only for local development." }));
}
