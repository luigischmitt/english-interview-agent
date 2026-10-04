import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {
  COLOR_SCHEME_STORAGE_KEY,
  THEME_BOOTSTRAP_SCRIPT,
  applyColorScheme,
  parseColorPreference,
  readStoredPreference,
  resolveColorScheme,
  writeStoredPreference,
} from "../src/lib/theme/color-scheme.mjs";

test("explicit preferences win over the OS setting", () => {
  assert.equal(resolveColorScheme("light", true), "light");
  assert.equal(resolveColorScheme("dark", false), "dark");
});

test("system and missing preferences follow the OS", () => {
  assert.equal(resolveColorScheme("system", true), "dark");
  assert.equal(resolveColorScheme("system", false), "light");
  assert.equal(resolveColorScheme(null, true), "dark");
  assert.equal(resolveColorScheme(undefined, false), "light");
});

test("invalid stored values fall back to system", () => {
  for (const bad of ["", "DARK", "blue", "1", {}, 0, "dark "]) {
    assert.equal(parseColorPreference(bad), "system");
  }
  assert.equal(resolveColorScheme("purple", true), "dark");
  assert.equal(resolveColorScheme("purple", false), "light");
});

test("storage read/write survives a throwing storage", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readStoredPreference(broken), "system");
  assert.equal(writeStoredPreference(broken, "dark"), false);
  assert.equal(readStoredPreference(null), "system");
});

test("storage round trip; system clears the key", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  assert.equal(writeStoredPreference(storage, "dark"), true);
  assert.equal(readStoredPreference(storage), "dark");
  writeStoredPreference(storage, "system");
  assert.equal(data.has(COLOR_SCHEME_STORAGE_KEY), false);
  assert.equal(readStoredPreference(storage), "system");
});

test("applyColorScheme sets attribute, daisy theme and native color-scheme", () => {
  const attrs = {};
  const root = { setAttribute: (k, v) => { attrs[k] = v; }, style: {} };
  applyColorScheme(root, "dark");
  assert.deepEqual(attrs, { "data-color-scheme": "dark", "data-theme": "interview-dark" });
  assert.equal(root.style.colorScheme, "dark");
});

function runBootstrap({ stored, prefersDark, throwingStorage = false, throwingMatchMedia = false }) {
  const attrs = {};
  const documentElement = { setAttribute: (k, v) => { attrs[k] = v; }, style: {} };
  const sandbox = {
    document: { documentElement },
    localStorage: {
      getItem: () => { if (throwingStorage) throw new Error("blocked"); return stored ?? null; },
    },
  };
  sandbox.window = {
    matchMedia: () => { if (throwingMatchMedia) throw new Error("no"); return { matches: prefersDark }; },
  };
  vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, sandbox);
  return { attrs, style: documentElement.style };
}

test("bootstrap script agrees with resolveColorScheme", () => {
  for (const stored of [null, "light", "dark", "system", "junk"]) {
    for (const prefersDark of [true, false]) {
      const { attrs, style } = runBootstrap({ stored, prefersDark });
      const expected = resolveColorScheme(stored, prefersDark);
      assert.equal(attrs["data-color-scheme"], expected, `${stored}/${prefersDark}`);
      assert.equal(attrs["data-theme"], `interview-${expected}`);
      assert.equal(style.colorScheme, expected);
    }
  }
});

test("bootstrap script still follows the OS when storage throws, and never throws", () => {
  assert.equal(runBootstrap({ prefersDark: true, throwingStorage: true }).attrs["data-color-scheme"], "dark");
  assert.equal(runBootstrap({ prefersDark: false, throwingStorage: true }).attrs["data-color-scheme"], "light");
  assert.doesNotThrow(() => runBootstrap({ prefersDark: true, throwingMatchMedia: true }));
});
