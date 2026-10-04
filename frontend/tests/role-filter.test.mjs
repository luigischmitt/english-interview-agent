import assert from "node:assert/strict";
import test from "node:test";
import { filterRoles, isKnownRole } from "../src/lib/interview/role-filter.mjs";

const roles = ["Software Engineer", "Data Engineer", "Data Scientist", "Machine Learning Engineer", "Engineering Manager"];

test("empty query returns every role", () => {
  assert.deepEqual(filterRoles(roles, ""), roles);
  assert.deepEqual(filterRoles(roles, "   "), roles);
});

test("matches words in any order and ignores case", () => {
  assert.deepEqual(filterRoles(roles, "engineer data"), ["Data Engineer"]);
  assert.deepEqual(filterRoles(roles, "SCIENT"), ["Data Scientist"]);
});

test("roles starting with the query come first, then original order", () => {
  assert.deepEqual(filterRoles(roles, "eng"), ["Engineering Manager", "Software Engineer", "Data Engineer", "Machine Learning Engineer"]);
});

test("ignores accents and returns nothing for unknown text", () => {
  assert.deepEqual(filterRoles(["Engenheiro de Software"], "engenhéiro"), ["Engenheiro de Software"]);
  assert.deepEqual(filterRoles(roles, "chef"), []);
});

test("isKnownRole compares normalized text", () => {
  assert.equal(isKnownRole(roles, " data engineer "), true);
  assert.equal(isKnownRole(roles, "Data"), false);
  assert.equal(isKnownRole(roles, ""), false);
});
