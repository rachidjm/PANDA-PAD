import { test } from "node:test";
import assert from "node:assert/strict";
import { imageIssue, IMAGE_MAX_BYTES, telegramLink, websiteLink, xLink } from "./fields";
import { FALLBACK_CREATE_LAMPORTS, FALLBACK_CURVE, FIRST_BUY_EXTRA_LAMPORTS, graduationLamports, launchCost, launchInfo, plausibleCreateCost } from "../pump/launch-info";

test("links: a handle becomes its profile address, an address is kept, nothing stays nothing", () => {
  assert.equal(xLink("@LaunchOnPanda"), "https://x.com/LaunchOnPanda");
  assert.equal(xLink("LaunchOnPanda"), "https://x.com/LaunchOnPanda");
  assert.equal(xLink("https://x.com/LaunchOnPanda"), "https://x.com/LaunchOnPanda");
  assert.equal(xLink("x.com/LaunchOnPanda"), "https://x.com/LaunchOnPanda");
  assert.equal(xLink("  "), "");
  assert.equal(telegramLink("@pandachat"), "https://t.me/pandachat");
  assert.equal(telegramLink("t.me/pandachat"), "https://t.me/pandachat");
  assert.equal(telegramLink(""), "");
  assert.equal(websiteLink("launchonpanda.app"), "https://launchonpanda.app");
  assert.equal(websiteLink("http://example.com/a"), "http://example.com/a");
  assert.equal(websiteLink(""), "");
});

test("image: only the accepted kinds, and never past the upload limit", () => {
  assert.equal(imageIssue({ type: "image/png", size: 1000 }), null);
  assert.equal(imageIssue({ type: "image/svg+xml", size: 1000 }), "type");
  assert.equal(imageIssue({ type: "image/gif", size: IMAGE_MAX_BYTES }), null);
  assert.equal(imageIssue({ type: "image/gif", size: IMAGE_MAX_BYTES + 1 }), "size");
});

test("graduation: the SOL that empties Pump.fun's curve, from its own starting reserves", () => {
  const lamports = graduationLamports(FALLBACK_CURVE);
  // 30 SOL x 1,073M / (1,073M - 793.1M) - 30 SOL = 85.005… SOL
  assert.ok(lamports > BigInt(85_000_000_000) && lamports < BigInt(85_010_000_000), String(lamports));
  const info = launchInfo(null, null);
  assert.equal(info.supply, 1_000_000_000);
  assert.ok(Math.abs(info.graduationSol - 85.005) < 0.005);
  assert.deepEqual(info.live, { curve: false, cost: false });
  assert.equal(graduationLamports({ ...FALLBACK_CURVE, initialRealTokenReserves: FALLBACK_CURVE.initialVirtualTokenReserves }), BigInt(0));
});

test("cost: a simulated figure is used only when believable; otherwise the measured reference", () => {
  assert.equal(launchInfo(FALLBACK_CURVE, 12_000_000).createLamports, 12_000_000);
  assert.equal(launchInfo(FALLBACK_CURVE, 12_000_000).live.cost, true);
  assert.equal(launchInfo(FALLBACK_CURVE, 0).createLamports, FALLBACK_CREATE_LAMPORTS);
  assert.equal(launchInfo(FALLBACK_CURVE, 5e12).createLamports, FALLBACK_CREATE_LAMPORTS);
  assert.equal(plausibleCreateCost(NaN), false);
});

test("cost summary: first buy + PANDA's fee on it + accounts and network; no first buy, no first-buy extras", () => {
  const info = launchInfo(null, null);
  const c = launchCost(info, 1, 100);
  assert.equal(c.firstBuy, 1);
  assert.equal(c.pandaFee, 0.01);
  assert.equal(c.network, (FALLBACK_CREATE_LAMPORTS + FIRST_BUY_EXTRA_LAMPORTS) / 1e9);
  assert.equal(c.total, c.firstBuy + c.pandaFee + c.network);
  const none = launchCost(info, 0, 100);
  assert.equal(none.network, FALLBACK_CREATE_LAMPORTS / 1e9);
  assert.equal(none.total, none.network);
  assert.equal(launchCost(info, NaN, 100).firstBuy, 0);
  assert.equal(launchCost(info, 2, 50).pandaFee, 0.01);
});
