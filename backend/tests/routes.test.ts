import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("backend routes", () => {
  it("exposes a health check", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it.each([
    ["/api/v1/transcriptions"],
    ["/api/v1/thinking"],
    ["/api/v1/formulations"],
  ])("keeps POST %s ready for its future service", async (path) => {
    const response = await request(app).post(path).send({});

    expect(response.status).toBe(501);
    expect(response.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("returns a consistent response for unknown routes", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
