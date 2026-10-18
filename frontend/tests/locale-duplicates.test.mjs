import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const localePath = fileURLToPath(new URL("../src/lib/locale.tsx", import.meta.url));

test("englishCopy has no duplicate keys", async () => {
  const source = await readFile(localePath, "utf8");
  const objectStart = source.indexOf("const englishCopy");
  assert.notEqual(objectStart, -1, "could not find englishCopy declaration");

  const objectEnd = source.indexOf("\n};", objectStart);
  assert.notEqual(objectEnd, -1, "could not find end of englishCopy object");

  const objectSource = source.slice(objectStart, objectEnd);
  const keyPattern = /^\s*("(?:[^"\\]|\\.)*")\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*$/gm;
  const seen = new Set();
  const duplicates = new Set();

  for (const match of objectSource.matchAll(keyPattern)) {
    const key = JSON.parse(match[1]);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }

  assert.deepEqual([...duplicates], [], `Duplicate englishCopy keys: ${[...duplicates].join(", ")}`);
});
