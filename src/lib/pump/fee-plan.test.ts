import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { formatBps, parsePercentToBps, planIssue, planLines, FeePlan, PlanContext } from "./fee-plan";
import { validateShareholders } from "./fee-shares-validation";
import { PANDA_TREASURY } from "./constants";

const creator = Keypair.generate().publicKey.toBase58();
const pool = Keypair.generate().publicKey.toBase58();
const partner = Keypair.generate().publicKey.toBase58();
const ctx: PlanContext = { creator, treasury: PANDA_TREASURY.toBase58(), rewardsPool: pool };
const plan = (over: Partial<FeePlan> = {}): FeePlan => ({ creatorBps: 9500, holdersBps: 0, partnerBps: 0, partnerAddress: "", ...over });

test("percent parsing is exact integer math and strict", () => {
  assert.equal(parsePercentToBps("70"), 7000);
  assert.equal(parsePercentToBps("12.5"), 1250);
  assert.equal(parsePercentToBps("0.25"), 25);
  assert.equal(parsePercentToBps("0.1"), 10);
  assert.equal(parsePercentToBps(" 95 "), 9500);
  assert.equal(parsePercentToBps("100"), 10000);
  for (const bad of ["", "-1", "101", "1e2", "1.234", "abc", "5%", ".5", "1,5", "Infinity", "NaN", "0x10", "1000"]) {
    assert.equal(parsePercentToBps(bad), null, bad);
  }
});

test("formatBps round-trips every value from 0 to 10000", () => {
  for (let bps = 0; bps <= 10_000; bps++) assert.equal(parsePercentToBps(formatBps(bps)), bps);
});

test("valid plans produce lists the server validator accepts", () => {
  const plans = [
    plan(),
    plan({ creatorBps: 7000, holdersBps: 2500 }),
    plan({ creatorBps: 7000, holdersBps: 2000, partnerBps: 500, partnerAddress: partner }),
    plan({ creatorBps: 0, holdersBps: 0, partnerBps: 9500, partnerAddress: partner }),
    plan({ creatorBps: 1234, holdersBps: 4321, partnerBps: 3945, partnerAddress: partner }),
  ];
  for (const p of plans) {
    assert.equal(planIssue(p, ctx), null);
    const lines = planLines(p, ctx);
    assert.equal(lines[0].kind, "panda");
    assert.equal(lines[0].bps, 500);
    assert.equal(lines.reduce((s, l) => s + l.bps, 0), 10_000);
    assert.equal(validateShareholders(lines.map((l) => ({ address: l.address, shareBps: l.bps }))), null);
  }
});

test("bad plans are flagged before sending", () => {
  assert.deepEqual(planIssue(plan({ creatorBps: 9000 }), ctx), { code: "TOTAL_MISMATCH", deltaBps: 500 });
  assert.deepEqual(planIssue(plan({ creatorBps: 9600 }), ctx), { code: "TOTAL_MISMATCH", deltaBps: -100 });
  assert.deepEqual(planIssue(plan({ creatorBps: 0 }), ctx), { code: "TOTAL_MISMATCH", deltaBps: 9500 });
  assert.equal(planIssue(plan({ creatorBps: 7000, holdersBps: 2500 }), { ...ctx, rewardsPool: null })?.code, "HOLDERS_UNAVAILABLE");
  assert.equal(planIssue(plan({ creatorBps: 9000, partnerBps: 500, partnerAddress: "nope" }), ctx)?.code, "PARTNER_ADDRESS_INVALID");
  assert.equal(planIssue(plan({ creatorBps: 9000, partnerBps: 500, partnerAddress: creator }), ctx)?.code, "PARTNER_ADDRESS_DUPLICATE");
  assert.equal(planIssue(plan({ creatorBps: 9000, partnerBps: 500, partnerAddress: ctx.treasury }), ctx)?.code, "PARTNER_ADDRESS_DUPLICATE");
  assert.equal(planIssue(plan({ creatorBps: NaN }), ctx)?.code, "TOTAL_MISMATCH");
  assert.equal(planIssue(plan({ creatorBps: -500, holdersBps: 10000 }), ctx)?.code, "TOTAL_MISMATCH");
});

test("PANDA's 5% can't be sidestepped through the plan: it is always line one and always 500", () => {
  for (let creatorBps = 0; creatorBps <= 9500; creatorBps += 500) {
    const lines = planLines(plan({ creatorBps, partnerBps: 9500 - creatorBps, partnerAddress: partner }), ctx);
    assert.deepEqual(lines[0], { kind: "panda", address: ctx.treasury, bps: 500 });
  }
});
