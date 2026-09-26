import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getWalletPortfolio, portfolioChange24h, totalPortfolioValueUsd } from "./portfolio";
import { change24hFromTopPool } from "@/lib/gecko/client";
import { getTokenMeta, mergeMeta } from "@/lib/tokens/meta";
import { fetchJupiterTokens } from "@/lib/jupiter/tokens";
import type { Coin, PortfolioHolding } from "@/lib/types";

const CLASSIC_UNKNOWN = "8aDwXsfRRSweYQubr3M3CcjDTQyZ3ZpftaC5oNhnuKC9"; // a token PANDA didn't launch (classic program)
const T22_PUMP = "DW79CfEpK5MLabxWUUAEqFff99hkkkiyQFhGPRZxpump"; // a recent pump.fun coin (Token-2022)
const PANDA_COIN = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump"; // launched on PANDA (Token-2022)
const SOL = "So11111111111111111111111111111111111111112";

const acct = (mint: string, ui: number, decimals = 6) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmount: ui, decimals } } } } } });
const fakeConnection = (byProgram: Record<string, unknown[]>, lamports = 15_300_000) =>
  ({
    getBalance: async () => lamports,
    getParsedTokenAccountsByOwner: async (_o: PublicKey, f: { programId: PublicKey }) => ({ value: byProgram[f.programId.toBase58()] ?? [] }),
  }) as unknown as Connection;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** Stubs PANDA's own /api/tokens/meta (the only thing the browser calls); returns the URLs asked. */
function metaApi(tokens: Record<string, object> | null) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return tokens === null ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ tokens }), { status: 200 });
  }) as typeof fetch;
  return calls;
}
const coin = (mint: string, changePct = 0): Coin => ({ mint, ticker: "OTC", name: "OTC coin", image: "https://img.test/otc.png", changePct }) as unknown as Coin;

test("everything a wallet app lists: SOL, classic AND Token-2022 tokens, one row per mint, each with USD value and 24h change", async () => {
  const calls = metaApi({
    [SOL]: { name: "Wrapped SOL", symbol: "SOL", priceUsd: 100, change24h: 1.4, image: "https://img.test/sol.png" },
    [T22_PUMP]: { name: "CateBrain", symbol: "CateBrain", priceUsd: 0.00002, change24h: -68.2, image: "https://img.test/cate.png" },
    [CLASSIC_UNKNOWN]: { name: "Crime Cat Protocol", symbol: "CRIMECAT", priceUsd: 0.0016, change24h: 12 },
  });
  const holdings = await getWalletPortfolio(
    fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4.004), acct(CLASSIC_UNKNOWN, 1)], [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(T22_PUMP, 192216.965816), acct(PANDA_COIN, 0)] }),
    Keypair.generate().publicKey,
    []
  );
  assert.equal(calls.length, 1, "one request to PANDA, and none to the indexers");
  assert.ok(calls[0].startsWith("/api/tokens/meta?mints="), calls[0]);
  const by = (m: string) => holdings.find((h) => h.mint === m)!;
  assert.equal(holdings.filter((h) => h.mint === CLASSIC_UNKNOWN).length, 1, "same-mint accounts are summed");
  assert.equal(by(CLASSIC_UNKNOWN).amount, 5.004);
  assert.equal(by(PANDA_COIN), undefined, "an empty account is not a holding");
  assert.equal(by(T22_PUMP).symbol, "CateBrain");
  assert.ok(Math.abs(by(T22_PUMP).valueUsd! - 192216.965816 * 0.00002) < 1e-6);
  assert.equal(by(T22_PUMP).changePct, -68.2, "24h change for a token PANDA didn't launch");
  assert.equal(by(SOL).changePct, 1.4, "SOL has a 24h change too");
  assert.equal(by(SOL).priceUsd, 100);
  assert.ok(Math.abs(by(SOL).valueUsd! - 1.53) < 1e-9);
  assert.equal(by(SOL).image, "https://img.test/sol.png");
  assert.ok(Math.abs(totalPortfolioValueUsd(holdings)! - (1.53 + by(T22_PUMP).valueUsd! + by(CLASSIC_UNKNOWN).valueUsd!)) < 1e-9);
  assert.equal(holdings[0].mint === SOL || holdings[0].valueUsd! >= holdings[1].valueUsd!, true, "sorted by value");
});

test("PANDA's own coin list wins over the metadata for name, logo and change", async () => {
  metaApi({ [SOL]: { priceUsd: 100 }, [PANDA_COIN]: { name: "OTC (indexer)", symbol: "OTCX", image: "https://img.test/indexer.png", priceUsd: 0.006, change24h: 3 } });
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(PANDA_COIN, 4034)] }), Keypair.generate().publicKey, [coin(PANDA_COIN, -7)]);
  const h = holdings.find((x) => x.mint === PANDA_COIN)!;
  assert.equal(h.symbol, "OTC");
  assert.equal(h.image, "https://img.test/otc.png");
  assert.equal(h.changePct, -7);
  assert.equal(h.priceUsd, 0.006);
});

test("no price and no 24h figure means none: the holding is listed, nothing is invented", async () => {
  metaApi({ [SOL]: { priceUsd: 100 }, [CLASSIC_UNKNOWN]: { name: "Dead token", symbol: "DEAD" } });
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4)] }), Keypair.generate().publicKey, []);
  const h = holdings.find((x) => x.mint === CLASSIC_UNKNOWN)!;
  assert.equal(h.priceUsd, undefined);
  assert.equal(h.valueUsd, undefined);
  assert.equal(h.changePct, undefined);
  assert.equal(h.symbol, "DEAD");
});

test("the metadata service being down doesn't hide anything: every holding and SOL are still listed", async () => {
  metaApi(null);
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(T22_PUMP, 5)] }), Keypair.generate().publicKey, []);
  assert.ok(holdings.find((x) => x.mint === T22_PUMP));
  const sol = holdings.find((x) => x.mint === SOL)!;
  assert.equal(sol.amount, 0.0153);
  assert.equal(sol.valueUsd, undefined);
});

const H = (valueUsd: number | undefined, changePct: number | undefined): PortfolioHolding => ({ mint: Keypair.generate().publicKey.toBase58(), amount: 1, decimals: 6, valueUsd, changePct });

test("the wallet's 24h change: what it is worth now vs. a day ago, only over holdings that have both a price and a change", () => {
  const c = portfolioChange24h([H(110, 10), H(50, -50), H(20, undefined), H(undefined, 5)])!;
  // a day ago: 110/1.1 = 100 and 50/0.5 = 100 → 200; now 160
  assert.ok(Math.abs(c.usd - -40) < 1e-9, String(c.usd));
  assert.ok(Math.abs(c.pct - -20) < 1e-9, String(c.pct));
  assert.equal(c.covered, 2);
  assert.equal(c.of, 3, "three holdings have a price; one of them has no 24h figure and is left out of both sides");
  assert.equal(portfolioChange24h([H(10, undefined), H(undefined, 3)]), null);
  assert.equal(portfolioChange24h([]), null);
  assert.equal(portfolioChange24h([H(5, -100)]), null, "a -100% change can't be turned back into a previous value");
});

// ── the server side: GeckoTerminal first, Jupiter for what it lacks ────────────────────────────────────────────────────
const pool = (base: string, h24: string | undefined) => ({ id: `solana_pool_${base.slice(0, 4)}`, attributes: { price_change_percentage: h24 === undefined ? {} : { h24 } }, relationships: { base_token: { data: { id: `solana_${base}` } } } });

test("a pool's 24h change counts for a token only when the token is the pool's BASE side (never another coin's change)", () => {
  const p = pool(T22_PUMP, "-68.208");
  const pools = new Map([[p.id, p as never]]);
  assert.equal(change24hFromTopPool(T22_PUMP, p.id, pools), -68.208);
  assert.equal(change24hFromTopPool(SOL, p.id, pools), undefined, "SOL is the quote side of that pool");
  assert.equal(change24hFromTopPool(T22_PUMP, "missing", pools), undefined);
  const noChange = pool(T22_PUMP, undefined);
  assert.equal(change24hFromTopPool(T22_PUMP, noChange.id, new Map([[noChange.id, noChange as never]])), undefined);
});

test("mergeMeta and getTokenMeta: Gecko wins, Jupiter fills only the gaps, and Jupiter is asked only about mints with gaps", async () => {
  const full = { address: "A", name: "Alpha", symbol: "ALP", decimals: 6, image_url: "https://img.test/a.png", price_usd: "0.5", change24h: 2 };
  const partial = { address: "B", name: "Beta", symbol: "BET", decimals: 6, image_url: "https://assets.geckoterminal.com/missing.png", price_usd: null };
  const asked: string[][] = [];
  const meta = await getTokenMeta(["A", "B", "C"], {
    gecko: async () => new Map<string, unknown>([["A", full], ["B", partial]]) as never,
    jupiter: async (m) => (asked.push(m), new Map([["B", { image: "https://jup.test/b.png", priceUsd: 3, change24h: -4 }], ["C", { name: "Gamma", symbol: "GAM", priceUsd: 1 }]])) as never,
  });
  assert.deepEqual(asked, [["B", "C"]], "A is complete: not sent to Jupiter");
  assert.deepEqual(meta.A, { name: "Alpha", symbol: "ALP", image: "https://img.test/a.png", priceUsd: 0.5, change24h: 2 });
  assert.equal(meta.B.name, "Beta");
  assert.equal(meta.B.image, "https://jup.test/b.png", "Gecko's 'missing' placeholder isn't a logo");
  assert.equal(meta.B.priceUsd, 3);
  assert.equal(meta.B.change24h, -4);
  assert.deepEqual(meta.C, { name: "Gamma", symbol: "GAM", image: undefined, priceUsd: 1, change24h: undefined });
  assert.equal(mergeMeta(undefined, undefined).priceUsd, undefined);
});

test("Jupiter's answer is parsed defensively (usdPrice, stats24h.priceChange, https icon) and any failure is 'nothing'", async () => {
  const ok = (async () => new Response(JSON.stringify([{ id: "A", name: "Alpha", symbol: "ALP", icon: "https://x.test/a.png", usdPrice: 2, stats24h: { priceChange: 5.5 } }, { id: "B", icon: "http://insecure.test/b.png", usdPrice: 0 }, { nope: 1 }]))) as unknown as typeof fetch;
  const got = await fetchJupiterTokens(["A", "B"], ok);
  assert.deepEqual(got.get("A"), { name: "Alpha", symbol: "ALP", image: "https://x.test/a.png", priceUsd: 2, change24h: 5.5 });
  assert.deepEqual(got.get("B"), { name: undefined, symbol: undefined, image: undefined, priceUsd: undefined, change24h: undefined });
  for (const bad of [(async () => new Response("x", { status: 500 })) as unknown as typeof fetch, (async () => { throw new Error("down"); }) as unknown as typeof fetch, (async () => new Response("{}")) as unknown as typeof fetch]) assert.equal((await fetchJupiterTokens(["A"], bad)).size, 0);
});

// ── junk airdropped to a wallet ─────────────────────────────────────────────────────────────────────────────────────────────
import { looksLikeSpam, clipLabel } from "@/lib/portfolio/spam";

test("ads airdropped to a wallet (a website or a sentence as the name) are recognised; real tickers and brand-new unpriced coins are not", () => {
  assert.equal(looksLikeSpam({ symbol: "PUMPAPI.IO DECODED SOLANA DATA STREAM FOR FREE | LOW LATENCY", name: "GET IT" }), true);
  assert.equal(looksLikeSpam({ symbol: "CLAIM", name: "Visit airdrop-rewards.xyz to claim" }), true);
  assert.equal(looksLikeSpam({ symbol: "X", name: "https://scam.example/claim" }), true);
  assert.equal(looksLikeSpam({ symbol: "PROMO", name: "get free tokens now visit our channel today please" }), true);
  for (const real of [{ symbol: "BONK", name: "Bonk" }, { symbol: "CateBrain", name: "CateBrain" }, { symbol: "WIF", name: "dogwifhat" }, { symbol: "USDC", name: "USD Coin" }, { symbol: "TDOF", name: "Trump Digital Oil Fund" }, { symbol: undefined, name: undefined }]) assert.equal(looksLikeSpam(real), false, JSON.stringify(real));
  assert.equal(clipLabel("PUMPAPI.IO DECODED SOLANA DATA STREAM"), "PUMPAPI.IO DE…");
  assert.equal(clipLabel("SOL"), "SOL");
});
