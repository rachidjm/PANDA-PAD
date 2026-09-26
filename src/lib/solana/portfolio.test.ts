import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getWalletPortfolio } from "./portfolio";
import type { Coin } from "@/lib/types";

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
const gecko = (handler: (url: string) => unknown) => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const body = handler(String(url));
    return body === null ? new Response("rate limited", { status: 429 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return calls;
};
const tok = (address: string, name: string, symbol: string, price: string | null, image = "https://img.test/x.png") => ({ attributes: { address, name, symbol, decimals: 6, image_url: image, price_usd: price } });

const coin = (mint: string): Coin => ({ mint, ticker: "OTC", name: "OTC coin", image: "https://img.test/otc.png" }) as unknown as Coin;

test("a Token-2022 holding (every recent pump.fun coin) appears in the portfolio, next to the classic-program ones", async () => {
  gecko((url) => (url.includes("/tokens/multi/") ? { data: [tok(T22_PUMP, "CateBrain", "CateBrain", "0.0000161"), tok(CLASSIC_UNKNOWN, "Crime Cat Protocol", "CRIMECAT", null), tok(SOL, "Wrapped SOL", "SOL", "100")] } : { data: [] }));
  const holdings = await getWalletPortfolio(
    fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4.004)], [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(T22_PUMP, 192216.965816)] }),
    Keypair.generate().publicKey,
    []
  );
  const cate = holdings.find((h) => h.mint === T22_PUMP);
  assert.ok(cate, "the Token-2022 coin is listed");
  assert.equal(cate.amount, 192216.965816);
  assert.equal(cate.symbol, "CateBrain");
  assert.ok(cate.valueUsd && Math.abs(cate.valueUsd - 192216.965816 * 0.0000161) < 1e-6, "and valued");
  assert.ok(holdings.find((h) => h.mint === CLASSIC_UNKNOWN), "the classic one is still listed");
});

test("tokens PANDA didn't launch get their name, logo and price from ONE batched request (not '?' and 'unavailable')", async () => {
  const calls = gecko((url) => (url.includes("/tokens/multi/") ? { data: [tok(CLASSIC_UNKNOWN, "Crime Cat Protocol", "CRIMECAT", "0.0016", "https://img.test/crime.png"), tok(SOL, "Wrapped SOL", "SOL", "100")] } : { data: [] }));
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4.004255)] }), Keypair.generate().publicKey, []);
  const h = holdings.find((x) => x.mint === CLASSIC_UNKNOWN)!;
  assert.equal(h.symbol, "CRIMECAT");
  assert.equal(h.name, "Crime Cat Protocol");
  assert.equal(h.image, "https://img.test/crime.png");
  assert.equal(h.priceUsd, 0.0016);
  assert.equal(calls.length, 1, `one request in total (${calls.join(" | ")})`);
  assert.equal(holdings.find((x) => x.mint === SOL)?.priceUsd, 100);
});

test("PANDA's own coin list wins over the batch for names and logos", async () => {
  gecko((url) => (url.includes("/tokens/multi/") ? { data: [tok(PANDA_COIN, "OTC (indexer)", "OTCX", "0.006", "https://img.test/indexer.png"), tok(SOL, "Wrapped SOL", "SOL", "100")] } : { data: [] }));
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(PANDA_COIN, 4034)] }), Keypair.generate().publicKey, [coin(PANDA_COIN)]);
  const h = holdings.find((x) => x.mint === PANDA_COIN)!;
  assert.equal(h.symbol, "OTC");
  assert.equal(h.image, "https://img.test/otc.png");
  assert.equal(h.priceUsd, 0.006);
});

test("a token the batch can't price falls back to its pools (the price of ITS side of the pool), and shows no price if there is none", async () => {
  gecko((url) => {
    if (url.includes("/tokens/multi/")) return { data: [tok(CLASSIC_UNKNOWN, "Crime Cat Protocol", "CRIMECAT", null), tok(SOL, "Wrapped SOL", "SOL", "100")] };
    if (url.includes(`/tokens/${CLASSIC_UNKNOWN}/pools`))
      return { data: [{ id: "p", attributes: { name: "CRIMECAT / SOL", address: "p", base_token_price_usd: "0.0016", quote_token_price_usd: "100", reserve_in_usd: "10", volume_usd: {}, price_change_percentage: {}, pool_created_at: null, fdv_usd: null, market_cap_usd: null }, relationships: { base_token: { data: { id: `solana_${CLASSIC_UNKNOWN}`, type: "token" } }, quote_token: { data: { id: `solana_${SOL}`, type: "token" } } } }] };
    return { data: [] };
  });
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4)] }), Keypair.generate().publicKey, []);
  assert.equal(holdings.find((x) => x.mint === CLASSIC_UNKNOWN)?.priceUsd, 0.0016);

  gecko((url) => (url.includes("/tokens/multi/") ? { data: [tok(SOL, "Wrapped SOL", "SOL", "100")] } : { data: [] }));
  const none = await getWalletPortfolio(fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 4)] }), Keypair.generate().publicKey, []);
  const h = none.find((x) => x.mint === CLASSIC_UNKNOWN)!;
  assert.equal(h.priceUsd, undefined);
  assert.equal(h.valueUsd, undefined, "no invented number");
});

test("GeckoTerminal rate-limiting the batch doesn't hide the holdings: they are listed (no name/price), SOL is still there", async () => {
  gecko(() => null);
  const holdings = await getWalletPortfolio(fakeConnection({ [TOKEN_2022_PROGRAM_ID.toBase58()]: [acct(T22_PUMP, 5)] }), Keypair.generate().publicKey, []);
  assert.ok(holdings.find((x) => x.mint === T22_PUMP));
  assert.ok(holdings.find((x) => x.mint === SOL));
});

test("several token accounts of one mint are one row; empty accounts are skipped", async () => {
  gecko(() => ({ data: [] }));
  const holdings = await getWalletPortfolio(
    fakeConnection({ [TOKEN_PROGRAM_ID.toBase58()]: [acct(CLASSIC_UNKNOWN, 1.5), acct(CLASSIC_UNKNOWN, 2.5), acct(T22_PUMP, 0)] }),
    Keypair.generate().publicKey,
    []
  );
  assert.equal(holdings.filter((h) => h.mint === CLASSIC_UNKNOWN).length, 1);
  assert.equal(holdings.find((h) => h.mint === CLASSIC_UNKNOWN)?.amount, 4);
  assert.equal(holdings.find((h) => h.mint === T22_PUMP), undefined);
});
