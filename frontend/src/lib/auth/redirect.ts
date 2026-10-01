const internalOrigin = "http://english-interview-agent.internal";

export function sanitizeNextPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const parsed = new URL(value, internalOrigin);

    if (parsed.origin !== internalOrigin || parsed.protocol !== "http:") {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
