import test from "node:test";
import assert from "node:assert/strict";
import { invalidateDashboardCache, readDashboardCache, refreshDashboardCache, writeDashboardCache } from "../src/lib/dashboard-data-cache.mjs";

test("dashboard cache returns a hit synchronously while a refresh updates it in the background", async () => {
  invalidateDashboardCache();
  writeDashboardCache("progress", ["old"]);
  let finish;
  const refreshing = refreshDashboardCache("progress", () => new Promise((resolve) => { finish = resolve; }));
  assert.deepEqual(readDashboardCache("progress"), ["old"]);
  await Promise.resolve();
  finish(["new"]);
  await refreshing;
  assert.deepEqual(readDashboardCache("progress"), ["new"]);
});

test("dashboard cache invalidates one key or the whole tab cache", () => {
  invalidateDashboardCache();
  writeDashboardCache("progress", [1]);
  writeDashboardCache("practice", [2]);
  invalidateDashboardCache("progress");
  assert.equal(readDashboardCache("progress"), undefined);
  assert.deepEqual(readDashboardCache("practice"), [2]);
  invalidateDashboardCache();
  assert.equal(readDashboardCache("practice"), undefined);
});
