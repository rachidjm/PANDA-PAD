import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONVERT_MARGINS_BPS, withMargin } from "./swap";

/** A Draw Your Trade buy paid with another coin: the swap to SOL comes first, and nothing else happens if it fails. */

test("the conversion sells a little more than the bare figure, never less", () => {
  assert.equal(withMargin(BigInt(1_000_000), 300), BigInt(1_030_001));
  assert.equal(withMargin(BigInt(1), 300), BigInt(2));
  assert.ok(CONVERT_MARGINS_BPS.every((m, i, a) => m > 0 && (i === 0 || m > a[i - 1])));
});

test("the swap must GUARANTEE the SOL needed (its minimum out, with a fixed slippage) and carries no PANDA fee", () => {
  const src = readFileSync("src/lib/jupiter/swap.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function buildConvertToSolTransaction"));
  assert.match(fn, /if \(BigInt\(quote\.otherAmountThreshold\) < lamports\) continue;/);
  assert.ok(fn.includes("dynamicSlippage: false"));
  assert.ok(!fn.includes("feeTransferInstructions") && !fn.includes("feeBpsForWallet"));
});

test("in the browser the swap is signed with the order and sent FIRST: a failure stops before the order is created", () => {
  const hook = readFileSync("src/components/coin/draw/useDrawTrade.ts", "utf8");
  const confirm = hook.slice(hook.indexOf("const confirm = useCallback"), hook.indexOf("const sendAndConfirm = useCallback"));
  const send = confirm.indexOf("connection.sendRawTransaction(signedSwap.serialize()");
  const create = confirm.indexOf('fetch("/api/strategy/create"');
  assert.ok(send > 0 && create > send, "the swap is sent and confirmed before the order is submitted");
  assert.ok(confirm.includes('throw new ApiError(err instanceof Error ? err.message : String(err), "convert_failed")'));
  assert.ok(confirm.includes("[...(swap ? [swap] : []), deposit, ...(feeTx ? [feeTx] : [])]"), "one signing batch");
  // The old lock is gone: every coin the wallet holds can be picked.
  const panel = readFileSync("src/components/coin/draw/DrawTradePanel.tsx", "utf8");
  assert.ok(!panel.includes("payOnlySolUsdc") && !panel.includes("allowed={"));
});
