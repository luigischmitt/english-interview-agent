const defaultAllowedOrigins = ["http://localhost:3000"];

export function getAllowedOrigins(value = process.env.ALLOWED_ORIGIN): string[] {
  const origins = value?.split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins?.length ? origins : defaultAllowedOrigins;
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins = getAllowedOrigins()): boolean {
  return !origin || allowedOrigins.includes(origin);
}
