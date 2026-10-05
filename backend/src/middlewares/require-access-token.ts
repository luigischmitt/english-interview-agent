import type { Request, RequestHandler } from "express";

import { AuthError, logAuthRejected, type AccessTokenVerifier } from "../auth/access-token-verifier.js";

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer +(\S+)$/iu.exec(header.trim());
  return match ? match[1]! : null;
}

/** Rejects requests without a valid Supabase access token. A null verifier means authentication is disabled. */
export function requireAccessToken(verifier: AccessTokenVerifier | null, isPublic: (request: Request) => boolean = () => false): RequestHandler {
  return async (request, response, next) => {
    if (isPublic(request)) return next();
    if (!verifier) {
      response.locals.authenticatedUser = { userId: "local-development" };
      return next();
    }
    const route = request.originalUrl.split("?")[0] ?? "";
    try {
      const token = bearerToken(request);
      if (!token) {
        logAuthRejected({ route }, "missing");
        response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." } });
        return;
      }
      response.locals.authenticatedUser = await verifier.verify(token);
      next();
    } catch (error) {
      const reason = error instanceof AuthError ? error.reason : "malformed";
      logAuthRejected({ route }, reason);
      if (error instanceof AuthError && error.status === 503) {
        response.status(503).json({ error: { code: "AUTH_UNAVAILABLE", message: "Não foi possível verificar sua sessão agora. Tente novamente em instantes." } });
        return;
      }
      response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente." } });
    }
  };
}
