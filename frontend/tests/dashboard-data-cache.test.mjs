import test from "node:test";
import assert from "node:assert/strict";
import { invalidateDashboardCache, readDashboardCache, refreshDashboardCache, sharedLoad, writeDashboardCache } from "../src/lib/dashboard-data-cache.mjs";

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

test("concurrent shared loads call the loader once and cache its successful value", async () => {
  invalidateDashboardCache();
  let calls = 0;
  let finish;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = sharedLoad("progress", loader);
  const second = sharedLoad("progress", loader);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ ok: true, value: ["loaded"] });
  await Promise.all([first, second]);
  assert.deepEqual(readDashboardCache("progress"), ["loaded"]);
});

test("invalidation during a shared load lets the next load start fresh", async () => {
  invalidateDashboardCache();
  let finishOld;
  let calls = 0;
  const oldLoad = sharedLoad("progress", () => {
    calls += 1;
    return new Promise((resolve) => { finishOld = resolve; });
  });
  await Promise.resolve();
  invalidateDashboardCache("progress");
  const freshLoad = sharedLoad("progress", async () => {
    calls += 1;
    return { ok: true, value: ["fresh"] };
  });
  await freshLoad;
  finishOld({ ok: true, value: ["stale"] });
  await oldLoad;
  assert.equal(calls, 2);
  assert.deepEqual(readDashboardCache("progress"), ["fresh"]);
});

test("rejected and failed shared loads are not cached", async () => {
  invalidateDashboardCache();
  await assert.rejects(sharedLoad("progress", async () => { throw new Error("failed"); }));
  assert.equal(readDashboardCache("progress"), undefined);
  const failed = await sharedLoad("progress", async () => ({ ok: false, message: "failed" }));
  assert.equal(failed.ok, false);
  assert.equal(readDashboardCache("progress"), undefined);
});
