import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatMoneyPrice, usdToEur } from "./format";

test("formatMoney: the right symbol per currency, compact above $1000, in both languages", () => {
  assert.equal(formatMoney(12.5, "USD", "en"), "$12.50");
  assert.equal(formatMoney(12.5, "EUR", "en"), "€12.50");
  assert.match(formatMoney(12.5, "EUR", "es"), /12,50\s*€/);
  assert.match(formatMoney(2_500_000, "USD", "en"), /^\$2\.5M$/);
  assert.match(formatMoney(-40, "USD", "en"), /-\$40\.00|\-40.00/); // Intl may place the sign either side
});

test("formatMoneyPrice: adaptive precision for tiny per-token prices, still currency-aware", () => {
  assert.equal(formatMoneyPrice(0, "USD", "en"), "$0.00");
  assert.equal(formatMoneyPrice(1.5, "USD", "en"), "$1.50");
  assert.match(formatMoneyPrice(0.000123, "EUR", "en"), /€0\.000123/);
});

test("usdToEur: divides by the USD-per-EUR rate; null propagates instead of guessing", () => {
  assert.equal(usdToEur(108, 1.08), 100);
  assert.equal(usdToEur(108, null), null);
  assert.equal(usdToEur(108, 0), null);
});
