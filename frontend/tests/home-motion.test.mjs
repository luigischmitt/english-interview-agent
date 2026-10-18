import assert from "node:assert/strict";
import test from "node:test";
import { getHomeParallaxOffset } from "../src/lib/home-motion.mjs";

test("keeps the home illustration parallax within its safe range", () => {
  assert.equal(getHomeParallaxOffset(450, 900), 0);
  assert.equal(getHomeParallaxOffset(-1_000, 900), 18);
  assert.equal(getHomeParallaxOffset(2_000, 900), -18);
});

test("returns no movement for invalid parallax measurements", () => {
  assert.equal(getHomeParallaxOffset(Number.NaN, 900), 0);
  assert.equal(getHomeParallaxOffset(200, 900, -1), 0);
});
