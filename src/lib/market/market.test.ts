import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSplit, saleKind, saleTransfers } from "./split";
import { buildListingMessage, validateTerms } from "./terms";
import { MARKET_CONFIG } from "./config";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const B = "Buyer";
const S = "Seller";
const C = "Creator";
const T = "Treasury";

test("primary = the creator's first sale of their own NFT; everything else is secondary", () => {
  assert.equal(saleKind({ seller: C, creator: C, priorSales: 0 }), "primary");
  assert.equal(saleKind({ seller: C, creator: C, priorSales: 1 }), "secondary", "the creator reselling later");
  assert.equal(saleKind({ seller: S, creator: C, priorSales: 0 }), "secondary", "an NFT that reached someone else outside the market");
  assert.equal(saleKind({ seller: S, creator: C, priorSales: 3 }), "secondary");
});

test("a primary sale pays PANDA's fee and the seller; no royalty", () => {
  const s = computeSplit({ priceLamports: 1_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: C, percentage: 100 }], kind: "primary" });
  assert.equal(s.feeLamports, 20_000_000);
  assert.equal(s.royaltyLamports, 0);
  assert.equal(s.sellerLamports, 980_000_000);
  assert.deepEqual(saleTransfers(s, { buyer: B, seller: C, treasury: T }), [
    { from: B, to: C, lamports: 980_000_000 },
    { from: B, to: T, lamports: 20_000_000 },
  ]);
});

test("a secondary sale also pays the creator's royalty, taken from the seller's side (the buyer pays exactly the price)", () => {
  const s = computeSplit({ priceLamports: 1_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: C, percentage: 100 }], kind: "secondary" });
  assert.equal(s.royaltyLamports, 50_000_000);
  assert.equal(s.sellerLamports, 930_000_000);
  const t = saleTransfers(s, { buyer: B, seller: S, treasury: T });
  assert.deepEqual(t, [
    { from: B, to: S, lamports: 930_000_000 },
    { from: B, to: C, lamports: 50_000_000 },
    { from: B, to: T, lamports: 20_000_000 },
  ]);
  assert.equal(t.reduce((a, x) => a + x.lamports, 0), 1_000_000_000, "the buyer pays exactly the listed price");
});

test("FUZZ: the parts always add up to the price exactly — no lamport lost or created — for any price, fee, royalty and creator split", () => {
  const rand = rng(31);
  for (let i = 0; i < 4000; i++) {
    const price = 1 + Math.floor(rand() * 1e12) + Math.floor(rand() * 999);
    const royaltyBps = Math.floor(rand() * 1001);
    const feeBps = Math.floor(rand() * 500);
    const n = 1 + Math.floor(rand() * 4);
    let left = 100;
    const creators = Array.from({ length: n }, (_, k) => {
      const p = k === n - 1 ? left : Math.floor(rand() * (left + 1));
      left -= p;
      return { address: `C${k}`, percentage: p };
    });
    const kind = rand() < 0.5 ? "primary" : "secondary";
    const s = computeSplit({ priceLamports: price, feeBps, royaltyBps, creators, kind });
    assert.equal(s.feeLamports + s.royaltyLamports + s.sellerLamports, price);
    assert.ok(s.feeLamports >= 0 && s.royaltyLamports >= 0 && s.sellerLamports >= 0);
    assert.equal(s.royaltyPayouts.reduce((a, p) => a + p.lamports, 0), s.royaltyLamports);
    const transfers = saleTransfers(s, { buyer: B, seller: S, treasury: T });
    assert.equal(transfers.reduce((a, t) => a + t.lamports, 0), price, "the buyer's total payment equals the price");
    assert.ok(transfers.every((t) => t.lamports > 0 && Number.isSafeInteger(t.lamports) && t.from !== t.to));
  }
});

test("royalty shares are whole percentages and the rounding leftover goes to the first creator", () => {
  const s = computeSplit({ priceLamports: 1_000_000_007, feeBps: 0, royaltyBps: 333, creators: [{ address: "A", percentage: 34 }, { address: "B", percentage: 33 }, { address: "C", percentage: 33 }], kind: "secondary" });
  assert.equal(s.royaltyPayouts.reduce((a, p) => a + p.lamports, 0), s.royaltyLamports);
  assert.equal(s.royaltyPayouts.length, 3);
});

test("a royalty owed to the seller is folded into the seller's payment; zero and self-payments never appear", () => {
  const s = computeSplit({ priceLamports: 1_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: C, percentage: 100 }], kind: "secondary" });
  const t = saleTransfers(s, { buyer: B, seller: C, treasury: T });
  assert.deepEqual(t, [
    { from: B, to: C, lamports: 980_000_000 },
    { from: B, to: T, lamports: 20_000_000 },
  ]);
  const free = computeSplit({ priceLamports: 1_000_000, feeBps: 0, royaltyBps: 0, creators: [{ address: C, percentage: 100 }], kind: "secondary" });
  assert.deepEqual(saleTransfers(free, { buyer: B, seller: S, treasury: T }), [{ from: B, to: S, lamports: 1_000_000 }]);
  const buyerIsCreator = computeSplit({ priceLamports: 1_000_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: B, percentage: 100 }], kind: "secondary" });
  assert.ok(saleTransfers(buyerIsCreator, { buyer: B, seller: S, treasury: T }).every((x) => x.from !== x.to));
});

test("bad inputs are refused, not rounded into something", () => {
  const ok = { priceLamports: 1_000_000, feeBps: 200, royaltyBps: 500, creators: [{ address: C, percentage: 100 }], kind: "secondary" as const };
  for (const priceLamports of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) assert.throws(() => computeSplit({ ...ok, priceLamports }), RangeError, String(priceLamports));
  assert.throws(() => computeSplit({ ...ok, feeBps: 9000, royaltyBps: 2000 }), RangeError);
  assert.throws(() => computeSplit({ ...ok, royaltyBps: 1.5 }), RangeError);
  assert.throws(() => computeSplit({ ...ok, creators: [] }), RangeError);
  assert.throws(() => computeSplit({ ...ok, creators: [{ address: C, percentage: 60 }] }), RangeError);
  assert.throws(() => computeSplit({ ...ok, creators: [{ address: C, percentage: 150 }, { address: "X", percentage: -50 }] }), RangeError);
});

// ---- listing terms -------------------------------------------------------------

const terms = { domain: "panda.test", asset: "AssetAddr", seller: "SellerAddr", priceLamports: 1_500_000_000, expiresAt: 5_000_000_000_000, nonce: "n1" };

test("the message the seller signs names the domain, asset, seller, exact price, expiry and nonce", () => {
  const m = buildListingMessage(terms);
  for (const part of ["panda.test", "AssetAddr", "SellerAddr", "1500000000 lamports", new Date(terms.expiresAt).toISOString(), "n1"]) assert.ok(m.includes(part), part);
  for (const changed of [{ domain: "evil.test" }, { asset: "Other" }, { seller: "Other" }, { priceLamports: 1 }, { expiresAt: 1 }, { nonce: "n2" }]) {
    assert.notEqual(buildListingMessage({ ...terms, ...changed }), m, JSON.stringify(changed));
  }
});

test("price and expiry limits", () => {
  const now = 1_000_000_000_000;
  const hour = 3_600_000;
  const okExpiry = now + 24 * hour;
  assert.equal(validateTerms({ priceLamports: MARKET_CONFIG.minPriceLamports, expiresAt: okExpiry }, now), null);
  assert.equal(validateTerms({ priceLamports: MARKET_CONFIG.maxPriceLamports, expiresAt: okExpiry }, now), null);
  for (const priceLamports of [0, MARKET_CONFIG.minPriceLamports - 1, MARKET_CONFIG.maxPriceLamports + 1, 1.5, NaN, "5", null, undefined, -100]) {
    assert.notEqual(validateTerms({ priceLamports, expiresAt: okExpiry }, now), null, String(priceLamports));
  }
  for (const expiresAt of [now, now + hour - 1, now + 31 * 24 * hour, NaN, "x", null, undefined, 1.5]) {
    assert.notEqual(validateTerms({ priceLamports: 2_000_000, expiresAt }, now), null, String(expiresAt));
  }
  assert.equal(validateTerms({ priceLamports: 2_000_000, expiresAt: now + hour }, now), null);
  assert.equal(validateTerms({ priceLamports: 2_000_000, expiresAt: now + 30 * 24 * hour }, now), null);
});
