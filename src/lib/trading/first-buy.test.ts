import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIRST_BUY_PRESETS, firstBuyFromInput, solToUnit, unitToSol } from "./amount";

const RATES = { solUsd: 100, eurUsd: 1.1 };
const NONE = { solUsd: null, eurUsd: null };

test("SOL: what is typed is what is spent — and a comma is a decimal mark (0,02 is 0.02 SOL, not 2)", () => {
  assert.deepEqual(firstBuyFromInput("SOL", "0.02", RATES), { sol: 0.02, noRate: false });
  assert.deepEqual(firstBuyFromInput("SOL", "0,02", RATES), { sol: 0.02, noRate: false });
  assert.deepEqual(firstBuyFromInput("SOL", "002", NONE), { sol: 2, noRate: false }, "only the input box strips it; a literal 002 is two");
  assert.deepEqual(firstBuyFromInput("SOL", "0.5", NONE), { sol: 0.5, noRate: false }, "SOL needs no rate");
});

test("dollars and euros convert with the live rates, rounded DOWN so it never spends more than typed", () => {
  assert.deepEqual(firstBuyFromInput("USD", "10", RATES), { sol: 0.1, noRate: false });
  assert.deepEqual(firstBuyFromInput("USD", "10,5", RATES), { sol: 0.105, noRate: false });
  assert.equal(firstBuyFromInput("EUR", "10", RATES).sol, unitToSol("EUR", 10, RATES));
  assert.ok(Math.abs(firstBuyFromInput("EUR", "10", RATES).sol - 0.11) < 1e-9, "€10 at 1.1 USD/EUR, SOL at $100 → 0.11 SOL");
  const odd = firstBuyFromInput("USD", "1", { solUsd: 137.77, eurUsd: 1.1 });
  assert.ok(odd.sol * 137.77 <= 1 + 1e-9);
});

test("no live rate → a dollar/euro figure can't be used (flagged, launch held back), never guessed; nothing typed → no buy", () => {
  assert.deepEqual(firstBuyFromInput("USD", "10", NONE), { sol: 0, noRate: true });
  assert.deepEqual(firstBuyFromInput("EUR", "10", { solUsd: 100, eurUsd: null }), { sol: 0, noRate: true });
  for (const empty of ["", "0", "0.0", ".", "abc"]) assert.deepEqual(firstBuyFromInput("USD", empty, NONE), { sol: 0, noRate: false }, empty);
});

test("switching unit keeps the same purchase: the converted figure buys the same SOL", () => {
  const sol = firstBuyFromInput("USD", "25", RATES).sol; // 0.25 SOL
  const asEur = solToUnit("EUR", sol, RATES)!;
  const back = firstBuyFromInput("EUR", String(Number(asEur.toFixed(2))), RATES).sol;
  assert.ok(Math.abs(back - sol) < 0.001, `${back} vs ${sol}`);
  for (const unit of ["SOL", "USD", "EUR"] as const) assert.equal(FIRST_BUY_PRESETS[unit].length, 4);
});

test("the Create screen uses it: one selector like buy/sell, the live conversion under the box, the converted SOL is what is bought and confirmed, and no rate holds the launch", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  const create = read("src/app/create/CreateClient.tsx");
  assert.match(create, /<FirstBuyField/);
  assert.match(create, /firstBuyFromInput\(firstBuyUnit, firstBuyAmount, rates\)/);
  assert.match(create, /const buyAmount = firstBuy\.sol;/);
  assert.match(create, /firstBuySol=\{firstBuy\.sol\}/);
  assert.match(create, /!firstBuy\.noRate/);
  assert.doesNotMatch(create, /parseFloat\(firstBuyAmount\)/, "the old SOL-only parse is gone");
  const field = read("src/components/create/FirstBuyField.tsx");
  assert.match(field, /\["SOL", "USD", "EUR"\]/);
  assert.match(field, /panda\.buy\.unit/);
  assert.match(field, /sanitizeDecimalInput/);
});
