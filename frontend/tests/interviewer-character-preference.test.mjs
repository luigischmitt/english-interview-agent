import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const types = readFileSync(new URL("../src/lib/interview/types.ts", import.meta.url), "utf8");
const defaults = readFileSync(new URL("../src/app/interview-config.ts", import.meta.url), "utf8");
const setup = readFileSync(new URL("../src/app/components/interview-setup.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../src/app/home-client.tsx", import.meta.url), "utf8");
const room = readFileSync(new URL("../src/app/components/interview-room.tsx", import.meta.url), "utf8");
const stage = readFileSync(new URL("../src/app/components/call-stage.tsx", import.meta.url), "utf8");

test("the animated interviewer is the session default and can be disabled in setup", () => {
  assert.match(types, /showInterviewerCharacter:\s*boolean/u);
  assert.match(defaults, /showInterviewerCharacter:\s*true/u);
  assert.match(setup, /id="show-interviewer-character"[\s\S]+label=\{t\("Personagem animado do entrevistador"\)\}[\s\S]+checked=\{showCharacter\}/u);
  assert.match(setup, /updateOption\("showInterviewerCharacter", checked\)/u);
  assert.match(setup, /readStoredInterviewerCharacter\(window\.localStorage\)/u);
  assert.match(setup, /storeInterviewerCharacter\(window\.localStorage, value\)/u);
  assert.match(setup, /showInterviewerCharacter: showCharacter/u);
  assert.match(home, /Personagem animado do entrevistador/u);
  assert.match(home, /storeInterviewerCharacter\(window\.localStorage, next\)/u);
  assert.doesNotMatch(home, /Esses recursos ainda não estão disponíveis/u);
});

test("the room carries the session preference to the stage and omits the avatar engine when disabled", () => {
  assert.match(room, /showCharacter=\{config\.showInterviewerCharacter !== false\}/u);
  assert.match(stage, /showCharacter\s*=\s*true/u);
  assert.match(stage, /showCharacter\s*\?\s*<ToucanAvatar/u);
  assert.match(stage, /src="\/landing\/tucano-mark\.webp"[\s\S]+alt=""[\s\S]+className="mt-static-mark"/u);
});
