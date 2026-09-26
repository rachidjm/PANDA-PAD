import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sanitizeDecimalInput as s } from "./input";

test('a comma is a decimal mark: "0,02" is 0.02 SOL, never 2 (the bug that turned it into "002")', () => {
  assert.equal(s("0,02"), "0.02");
  assert.equal(parseFloat(s("0,02")), 0.02);
  assert.equal(s("0.02"), "0.02");
  assert.equal(s("0,002"), "0.002");
  assert.equal(s(",5"), ".5");
  assert.equal(parseFloat(s(",5")), 0.5);
});

test("typing keeps working step by step, in both notations", () => {
  for (const sep of [".", ","]) {
    assert.equal(s("0"), "0");
    assert.equal(s(`0${sep}`), "0.");
    assert.equal(s(`0${sep}0`), "0.0");
    assert.equal(s(`0${sep}02`), "0.02");
  }
  assert.equal(s(""), "");
});

test("thousands separators, junk and a second separator can't change the magnitude", () => {
  assert.equal(s("1.234,5"), "1234.5");
  assert.equal(s("1,234.5"), "1234.5");
  assert.equal(s("1,5,"), "15.");
  assert.equal(s("12abc,5€"), "12.5");
  assert.equal(s("-3"), "3");
  assert.equal(s("1e3"), "13");
  assert.equal(s("  0 , 02 "), "0.02");
});

test("no amount or price box still strips the comma with the old regex", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(n) && readFileSync(p, "utf8").includes("replace(/[^0-9.]/g")) offenders.push(path.relative(process.cwd(), p));
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(offenders, [], "these inputs would turn 0,02 into 002");
});
