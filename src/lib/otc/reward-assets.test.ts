import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { OTC_REWARD_ASSETS, isValidOtcRewardAsset, otcRewardAssetByMint } from "./reward-assets";

test("every reward asset is a real public key, and the list has no duplicates", () => {
  const mints = new Set<string>();
  for (const a of OTC_REWARD_ASSETS) {
    assert.doesNotThrow(() => new PublicKey(a.mint), `${a.symbol}'s mint isn't a valid pubkey`);
    assert.ok(a.symbol.length > 0 && a.name.length > 0);
    assert.equal(mints.has(a.mint), false, `${a.symbol} duplicated`);
    mints.add(a.mint);
  }
  assert.ok(OTC_REWARD_ASSETS.length >= 10);
});

test("isValidOtcRewardAsset / otcRewardAssetByMint agree with the list", () => {
  for (const a of OTC_REWARD_ASSETS) {
    assert.equal(isValidOtcRewardAsset(a.mint), true);
    assert.equal(otcRewardAssetByMint(a.mint)?.symbol, a.symbol);
  }
  assert.equal(isValidOtcRewardAsset("So11111111111111111111111111111111111111112"), false, "SOL is not on the offered list");
  assert.equal(isValidOtcRewardAsset("not-a-mint"), false);
  assert.equal(otcRewardAssetByMint("not-a-mint"), undefined);
});
