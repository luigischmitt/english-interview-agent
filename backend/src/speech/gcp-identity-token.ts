import { SpeechProviderUnavailableError } from "./errors.js";

const metadataHost = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const fallbackTtlMs = 50 * 60_000;
const refreshMarginMs = 5 * 60_000;
const metadataTimeoutMs = 1_000;

export type IdTokenProvider = { getToken(): Promise<string> };

type Options = {
  /** Cloud Run service URL; only its origin is used as the token audience. */
  audienceUrl: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

function expiryFromJwt(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Fetches Google identity tokens from the metadata server and caches them until shortly before expiry. Never logs tokens. */
export function createGcpIdTokenProvider({ audienceUrl, fetchImplementation = fetch, now = Date.now, timeoutMs = metadataTimeoutMs }: Options): IdTokenProvider {
  const audience = new URL(audienceUrl).origin;
  const url = `${metadataHost}?audience=${encodeURIComponent(audience)}`;
  let cached: { token: string; refreshAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Metadata request timed out.")), timeoutMs);
    try {
      const response = await fetchImplementation(url, { headers: { "Metadata-Flavor": "Google" }, signal: controller.signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Metadata server returned HTTP ${response.status}.`);
      }
      const token = (await response.text()).trim();
      if (!token) throw new Error("Metadata server returned no token.");
      const expiresAt = expiryFromJwt(token) ?? now() + fallbackTtlMs;
      cached = { token, refreshAt: expiresAt - refreshMarginMs };
      return token;
    } catch (error) {
      // Only a fixed message: the cause is never attached so nothing sensitive can reach logs.
      throw new SpeechProviderUnavailableError("GCP identity token is unavailable.", { cause: error instanceof Error ? error.name : undefined });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getToken() {
      if (cached && now() < cached.refreshAt) return cached.token;
      inFlight ??= fetchToken().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
