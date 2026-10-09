import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountForPct,
  classifyFailure,
  committedRaw,
  feeFor,
  isTriggered,
  MAX_TRANCHES,
  minOutFor,
  SELL_MARGIN_BPS,
  stateAfterFailure,
  STOP_MARGIN_BPS,
  triggerOutFor,
  validateTranches,
} from "./math";

const B = (n: number | string) => BigInt(n);

test("any % of the free balance, with no minimum: 5%, 10%, 15%, 20%… and one decimal (Otro)", () => {
  assert.equal(amountForPct(B(1_000_000), 5), B(50_000));
  assert.equal(amountForPct(B(1_000_000), 15), B(150_000));
  assert.equal(amountForPct(B(1_000_000), 33.3), B(333_000));
  assert.equal(amountForPct(B(999), 100), B(999));
  assert.equal(amountForPct(B(3), 10), B(0), "rounded down: never more than the share");
  assert.equal(amountForPct(B(1_000), 0), B(0));
  assert.equal(amountForPct(B(1_000), 101), B(0));
});

test("the trigger is the live quote scaled by drawn/current; the signed minimum is the trigger minus 1% (sell) / 3% (stop)", () => {
  const cur = B(1_000_000_000); // selling the amount pays 1 SOL now
  const tp = triggerOutFor(cur, 2, 1); // drawn at 2× the price
  assert.equal(tp, B(2_000_000_000));
  assert.equal(minOutFor(tp, "sell"), (tp * B(10_000 - SELL_MARGIN_BPS)) / B(10_000));
  const sl = triggerOutFor(cur, 0.7, 1);
  assert.equal(sl, B(700_000_000));
  assert.equal(minOutFor(sl, "stop"), (sl * B(10_000 - STOP_MARGIN_BPS)) / B(10_000));
  assert.ok(minOutFor(sl, "stop") < sl, "the margin is BELOW the marked price, never above");
  assert.equal(triggerOutFor(cur, 0, 1), B(0));
});

test("PANDA's fee is the wallet's per-trade bps of the GUARANTEED minimum", () => {
  assert.equal(feeFor(B(1_000_000_000), 100), B(10_000_000)); // 1%
  assert.equal(feeFor(B(1_000_000_000), 50), B(5_000_000)); // 0.5%
  assert.equal(feeFor(B(1_000_000_000), 0), B(0));
});

test("a sell triggers at or above its level, a stop at or below", () => {
  assert.equal(isTriggered("sell", B(100), B(100)), true);
  assert.equal(isTriggered("sell", B(99), B(100)), false);
  assert.equal(isTriggered("stop", B(100), B(100)), true);
  assert.equal(isTriggered("stop", B(101), B(100)), false);
});

test("drawing rules: sell above and stop below the CURRENT price, sell above stop, ≤100% in total, ≤ MAX_TRANCHES", () => {
  const ok = validateTranches([{ trancheId: "aaaa-1", pct: 50, sellUsd: 2, stopUsd: 0.5 }], 1);
  assert.ok(ok instanceof Map);
  assert.deepEqual((ok as Map<string, string[]>).get("aaaa-1"), []);
  const bad = validateTranches(
    [
      { trancheId: "aaaa-1", pct: 10, sellUsd: 0.9 },
      { trancheId: "aaaa-2", pct: 10, stopUsd: 1.1 },
      { trancheId: "aaaa-3", pct: 10, sellUsd: 1.2, stopUsd: 1.3 },
      { trancheId: "aaaa-4", pct: 10, sellUsd: 1000 },
    ],
    1
  ) as Map<string, string[]>;
  assert.ok(bad.get("aaaa-1")!.includes("sell_not_above_current"));
  assert.ok(bad.get("aaaa-2")!.includes("stop_not_below_current"));
  assert.ok(bad.get("aaaa-3")!.includes("stop_not_below_current"));
  assert.ok(bad.get("aaaa-4")!.includes("too_far"));
  assert.equal(validateTranches([{ trancheId: "aaaa-1", pct: 60, sellUsd: 2 }, { trancheId: "aaaa-2", pct: 50, stopUsd: 0.5 }], 1), "over_100");
  assert.equal(validateTranches(Array.from({ length: MAX_TRANCHES + 1 }, (_, i) => ({ trancheId: `aaaa-${i}`, pct: 1, sellUsd: 2 })), 1), "too_many");
  assert.equal(validateTranches([], 1), "invalid");
  const noLeg = validateTranches([{ trancheId: "aaaa-1", pct: 10 }], 1) as Map<string, string[]>;
  assert.ok(noLeg.get("aaaa-1")!.includes("invalid"));
});

test("tokens already promised are counted ONCE per nonce (a sell and a stop of one tranche sell the same tokens)", () => {
  const orders = [
    { nonceAccount: "N1", tokenAmountRaw: "500", state: "active" as const },
    { nonceAccount: "N1", tokenAmountRaw: "500", state: "active" as const }, // its stop
    { nonceAccount: "N2", tokenAmountRaw: "200", state: "sending" as const },
    { nonceAccount: "N3", tokenAmountRaw: "999", state: "executed" as const }, // already sold: frees nothing, counts nothing
    { nonceAccount: "N4", tokenAmountRaw: "300", state: "needs_resign" as const },
  ];
  assert.equal(committedRaw(orders), B(700));
});

test("simulation failures are classified from Pump's real error logs", () => {
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 6003 }] }, ["Program log: AnchorError ... Error Code: TooLittleSolReceived. Error Number: 6003."]), "slippage");
  assert.equal(classifyFailure({ InstructionError: [4, { Custom: 6004 }] }, ["Program log: AnchorError ... Error Code: ExceededSlippage. Error Number: 6004."]), "slippage");
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 6023 }] }, ["Error Code: NotEnoughTokensToSell."]), "no_balance");
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 6005 }] }, ["Error Code: BondingCurveComplete."]), "migrated");
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 6000 }] }, ["fee_recipient.rs:35. Error Code: NotAuthorized."]), "program_changed");
  assert.equal(classifyFailure({ InstructionError: [3, { Custom: 6057 }] }, ["Error Code: BuybackFeeRecipientNotAuthorized."]), "program_changed");
  assert.equal(classifyFailure("BlockhashNotFound", []), "nonce_used");
  assert.equal(classifyFailure("AccountNotFound", []), "no_sol");
  assert.equal(classifyFailure({ InstructionError: [9, "Weird"] }, []), "unknown");
});

test("what a failure does to an order: slippage and no SOL keep it active; migration / program change / no balance → re-sign", () => {
  assert.equal(stateAfterFailure("slippage", 0), null);
  assert.equal(stateAfterFailure("no_sol", 0), null);
  assert.deepEqual(stateAfterFailure("migrated", 0), { state: "needs_resign", reason: "migrated" });
  assert.deepEqual(stateAfterFailure("program_changed", 0), { state: "needs_resign", reason: "program_changed" });
  assert.deepEqual(stateAfterFailure("no_balance", 0), { state: "needs_resign", reason: "no_balance" });
  assert.deepEqual(stateAfterFailure("nonce_used", 0), { state: "cancelled", reason: "nonce_used" });
  assert.equal(stateAfterFailure("unknown", 2), null);
  assert.deepEqual(stateAfterFailure("unknown", 3), { state: "needs_resign", reason: "unknown" });
});
