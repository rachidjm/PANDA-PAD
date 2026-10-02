import { test } from "node:test";
import assert from "node:assert/strict";
import { TIMEFRAMES, GECKO_PRESETS, DEXPAPRIKA_FALLBACKS, FRESH_TTL_MS } from "./config";

test("every timeframe has a Gecko preset and a fresh-TTL entry", () => {
  for (const tf of TIMEFRAMES) {
    assert.ok(GECKO_PRESETS[tf], `missing GECKO_PRESETS.${tf}`);
    assert.ok(GECKO_PRESETS[tf].limit > 0);
    assert.ok(FRESH_TTL_MS[tf] > 0, `missing/invalid FRESH_TTL_MS.${tf}`);
  }
});

test("DexPaprika fallbacks only exist for timeframes its own documented free limits can actually cover (1h, 1d, 1w) — not 1m/5m/4h/30d", () => {
  const withFallback = Object.keys(DEXPAPRIKA_FALLBACKS).sort();
  assert.deepEqual(withFallback, ["1d", "1h", "1w"]);
  for (const tf of withFallback as (keyof typeof DEXPAPRIKA_FALLBACKS)[]) {
    assert.ok(TIMEFRAMES.includes(tf as (typeof TIMEFRAMES)[number]));
  }
});

test("only the 1w fallback needs a key (7-day depth) — 1h/1d work keyless (real limit: last 24h)", () => {
  assert.equal(DEXPAPRIKA_FALLBACKS["1h"]?.needsKey, false);
  assert.equal(DEXPAPRIKA_FALLBACKS["1d"]?.needsKey, false);
  assert.equal(DEXPAPRIKA_FALLBACKS["1w"]?.needsKey, true);
});
