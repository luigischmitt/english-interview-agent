import { Router, type RequestHandler } from "express";

import { AdminUsageService } from "../admin/usage-service.js";

export function isAdmin(userId: string | undefined, adminUserIds = process.env.ADMIN_USER_IDS): boolean {
  if (!userId) return false;
  return new Set((adminUserIds ?? "").split(",").map((id) => id.trim()).filter(Boolean)).has(userId);
}

export function createAdminStatusHandler(adminUserIds = process.env.ADMIN_USER_IDS): RequestHandler {
  return (_request, response) => {
    const admin = isAdmin(response.locals.authenticatedUser?.userId, adminUserIds);
    console.info(JSON.stringify({ event: "admin_status_requested" }));
    response.json({ admin });
  };
}

export function createAdminUsageHandler(service = new AdminUsageService(), adminUserIds = process.env.ADMIN_USER_IDS): RequestHandler {
  return async (request, response, next) => {
    if (!isAdmin(response.locals.authenticatedUser?.userId, adminUserIds)) {
      console.info(JSON.stringify({ event: "admin_usage_denied" }));
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Acesso administrativo necessário." } });
      return;
    }
    try {
      console.info(JSON.stringify({ event: "admin_usage_requested" }));
      response.json(await service.getUsage(request.query.refresh === "1"));
    } catch (error) { next(error); }
  };
}

export function createAdminRouter(service = new AdminUsageService(), adminUserIds = process.env.ADMIN_USER_IDS) {
  const router = Router();
  router.get("/status", createAdminStatusHandler(adminUserIds));
  router.get("/usage", createAdminUsageHandler(service, adminUserIds));
  return router;
}
