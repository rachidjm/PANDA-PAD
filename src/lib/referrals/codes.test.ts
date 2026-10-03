import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidRecruiterCode, normalizeRecruiterCode, recruiterCodeProblem } from "./codes";

test("recruiterCodeProblem: a real, reasonable code passes", () => {
  assert.equal(recruiterCodeProblem("rachid"), null);
  assert.equal(recruiterCodeProblem("abc"), null, "the minimum length");
  assert.equal(recruiterCodeProblem("a".repeat(20)), null, "the maximum length");
  assert.equal(recruiterCodeProblem("my-code-123"), null, "hyphens between alphanumerics are fine");
  assert.equal(recruiterCodeProblem("RACHID"), null, "case-insensitive — normalized before checking");
});

test("recruiterCodeProblem: length bounds", () => {
  assert.equal(recruiterCodeProblem("ab"), "too_short");
  assert.equal(recruiterCodeProblem("a".repeat(21)), "too_long");
});

test("recruiterCodeProblem: format — lowercase/digits/single internal hyphens only, never at the ends or doubled", () => {
  assert.equal(recruiterCodeProblem("has space"), "bad_format");
  assert.equal(recruiterCodeProblem("has_underscore"), "bad_format");
  assert.equal(recruiterCodeProblem("-leading"), "bad_format");
  assert.equal(recruiterCodeProblem("trailing-"), "bad_format");
  assert.equal(recruiterCodeProblem("double--hyphen"), "bad_format");
  assert.equal(recruiterCodeProblem("emoji😀code"), "bad_format");
});

test("recruiterCodeProblem: reserved words — brand/role impersonation and the profanity list", () => {
  assert.equal(recruiterCodeProblem("panda"), "reserved");
  assert.equal(recruiterCodeProblem("admin"), "reserved");
  assert.equal(recruiterCodeProblem("oficial"), "reserved");
  assert.equal(recruiterCodeProblem("official"), "reserved");
  assert.equal(recruiterCodeProblem("PANDA"), "reserved", "case-insensitive");
  assert.equal(recruiterCodeProblem("mierda"), "reserved");
});

test("isValidRecruiterCode mirrors recruiterCodeProblem", () => {
  assert.equal(isValidRecruiterCode("rachid"), true);
  assert.equal(isValidRecruiterCode("panda"), false);
  assert.equal(isValidRecruiterCode("ab"), false);
});

test("normalizeRecruiterCode: trims and lowercases, so lookups and the format check agree", () => {
  assert.equal(normalizeRecruiterCode("  Rachid  "), "rachid");
});
