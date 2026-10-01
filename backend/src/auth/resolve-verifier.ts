import { loadAuthConfig } from "./config.js";
import { createAccessTokenVerifier, warnAuthDisabledOnce, type AccessTokenVerifier } from "./access-token-verifier.js";

/** Returns null when authentication is disabled; throws at startup when it is required but misconfigured. */
export function resolveAccessTokenVerifier(env: NodeJS.ProcessEnv = process.env): AccessTokenVerifier | null {
  const config = loadAuthConfig(env);
  if (!config.required) {
    warnAuthDisabledOnce();
    return null;
  }
  return createAccessTokenVerifier({ supabaseUrl: config.supabaseUrl!, publishableKey: config.publishableKey });
}
