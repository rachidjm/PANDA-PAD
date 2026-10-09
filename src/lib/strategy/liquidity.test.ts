import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLiquidityUsd } from "./liquidity";
import { validateKind } from "./kinds";

test("a coin still on its Pump.fun curve (no pool, no feed figure): liquidity = its real SOL reserves ×2 at the SOL price", () => {
  const r = resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: true, realSolLamports: 3_000_000_000 }, poolSolLamports: null, solUsd: 150 });
  assert.deepEqual(r, { liquidityUsd: 900, source: "curve" });
  // A brand-new curve nobody has bought into yet: readable, and really 0 — never "unknown".
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: true, realSolLamports: 0 }, poolSolLamports: null, solUsd: 150 }), { liquidityUsd: 0, source: "curve" });
});

test("a graduated coin: the feed's pool figure first; if the feed doesn't know it yet, its PumpSwap pool's SOL side ×2", () => {
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: 250_000, curve: { complete: true, solQuoted: true, realSolLamports: 0 }, poolSolLamports: 1, solUsd: 150 }), { liquidityUsd: 250_000, source: "dex" });
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: null, curve: { complete: true, solQuoted: true, realSolLamports: 0 }, poolSolLamports: 100_000_000_000, solUsd: 150 }), { liquidityUsd: 30_000, source: "pool" });
});

test("nothing readable (no feed, no curve, no pool, or no SOL price): null — not a made-up number", () => {
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: null, curve: null, poolSolLamports: null, solUsd: 150 }), { liquidityUsd: null, source: null });
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: true, realSolLamports: 5e9 }, poolSolLamports: null, solUsd: null }), { liquidityUsd: null, source: null });
  // A curve quoted in USDC isn't priced in SOL here: not guessed.
  assert.deepEqual(resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: false, realSolLamports: 5e9 }, poolSolLamports: null, solUsd: 150 }), { liquidityUsd: null, source: null });
});

test("with the curve read, a held-coin sell is no longer blocked as 'liquidity unknown' — a tiny curve is 'too small' (Jupiter's own rule), and a PANDA order (no liquidity gate) passes", () => {
  const curve = resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: true, realSolLamports: 3_000_000_000 }, poolSolLamports: null, solUsd: 150 }).liquidityUsd;
  const jupiter = validateKind("sell", { sell: 2 }, { currentUsd: 1, tokensUsd: 20, liquidityUsd: curve });
  assert.ok(!jupiter.includes("liquidity_unknown"));
  assert.ok(jupiter.includes("liquidity_low"));
  const big = validateKind("sell", { sell: 2 }, { currentUsd: 1, tokensUsd: 20, liquidityUsd: resolveLiquidityUsd({ dexUsd: null, curve: { complete: false, solQuoted: true, realSolLamports: 60e9 }, poolSolLamports: null, solUsd: 150 }).liquidityUsd });
  assert.deepEqual(big, []);
  const panda = validateKind("sell", { sell: 2 }, { currentUsd: 1, tokensUsd: 0.5, minOrderUsd: 0 });
  assert.deepEqual(panda, []);
});
