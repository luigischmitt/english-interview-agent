export type AuthConfig = {
  required: boolean;
  /** Public Supabase project URL without a trailing slash; null only when authentication is disabled. */
  supabaseUrl: string | null;
  /** Optional public key enabling the remote token check for non-ES256 or unknown-kid tokens. */
  publishableKey?: string;
};

const localHosts = new Set(["localhost", "127.0.0.1"]);

function parseSupabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL such as https://<project>.supabase.co.");
  }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && localHosts.has(url.hostname);
  if (!secure && !local) throw new Error("SUPABASE_URL must use https (http is accepted only for localhost or 127.0.0.1).");
  return url.href.replace(/\/+$/, "");
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const flag = env.BACKEND_AUTH_REQUIRED?.trim().toLowerCase();
  if (flag !== undefined && flag !== "" && flag !== "true" && flag !== "false") {
    throw new Error("BACKEND_AUTH_REQUIRED must be \"true\" or \"false\".");
  }
  const required = flag !== "false";
  const rawUrl = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const optional = publishableKey ? { publishableKey } : {};
  if (!required) return { required, supabaseUrl: rawUrl ? parseSupabaseUrl(rawUrl) : null, ...optional };
  if (!rawUrl) throw new Error("SUPABASE_URL is required while BACKEND_AUTH_REQUIRED is true. Set it to the Supabase project URL (the same value as NEXT_PUBLIC_SUPABASE_URL), or set BACKEND_AUTH_REQUIRED=false for local development only.");
  return { required, supabaseUrl: parseSupabaseUrl(rawUrl), ...optional };
}
