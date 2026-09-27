import { Connection, PublicKey } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { solPriceUsd } from "@/lib/solana/prices";
import { fetchPumpCoins } from "@/lib/pump/frontend-api";
import { fetchDexTokensBatch } from "@/lib/dexscreener/client";
import { fetchSwapSignatures, heliusApiKeyFromRpcUrl } from "@/lib/solana/helius";
import { LoggedTrade, addEstimatedTrades, getBackfillMark, setBackfillMark } from "./trade-log";
import { deriveTrade } from "./derive-trade";

// Without a Helius key (so nothing pre-filters "is this even a swap?"), only the last 80 signatures are scanned,
// most of which won't be swaps. With one, Helius's own parser hands back up to 100 signatures it already tagged
// as SWAP — same RPC-based amount-reading below, just pointed at signatures far more likely to be real trades.
const SIGNATURE_LIMIT = 80;
const SIGNATURE_LIMIT_HELIUS = 100;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 22_000;
const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000;

/** True if this wallet's on-chain history hasn't been scanned yet (or not in the last day). */
export async function needsBackfill(wallet: string): Promise<boolean> {
  const marker = await getBackfillMark(wallet);
  return !marker || Date.now() - marker.at > RESCAN_AFTER_MS;
}

type Candidate = { mint: string; side: "buy" | "sell"; solAmount: number; tokenAmount: number; signature: string; ts: number };

/**
 * Reads the wallet's recent on-chain history and turns each SOL⇄token swap
 * into a logged trade, so Portfolio can show positions for trades made
 * OUTSIDE PANDA too. These are estimates, and are stored flagged as such:
 *  - the last ~80 signatures are scanned (~100 when SOLANA_RPC_URL is a Helius RPC: Helius's own Parsed
 *    Transaction History API pre-filters to signatures it already tags SWAP, in one HTTP call, so the same
 *    time budget covers more real trades and fewer irrelevant transfers/votes);
 *  - only swaps against SOL (not USDC/USDT) are recognised;
 *  - the SOL amount is the wallet's net SOL change (includes the network fee
 *    and any account rent), and USD uses TODAY's SOL price, not the price at the time.
 * Either way, the actual buy/sell/amounts are always read the same way: raw pre/post balance deltas via
 * `getParsedTransaction` + `deriveTrade` — never Helius's own swap categorization, which a bonding-curve
 * program it doesn't recognise could miss.
 * Returns how many new trades were added. Throws if the RPC can't be read
 * (in which case nothing is marked as scanned, so it retries later).
 */
export async function backfillTrades(wallet: string): Promise<number> {
  const started = Date.now();
  const rpcUrl = serverRpcUrl();
  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(wallet);

  const heliusKey = heliusApiKeyFromRpcUrl(rpcUrl);
  const swaps = heliusKey ? await fetchSwapSignatures(wallet, heliusKey, SIGNATURE_LIMIT_HELIUS) : null;
  const infos: { signature: string }[] = swaps ?? (await conn.getSignaturesForAddress(owner, { limit: SIGNATURE_LIMIT })).filter((s) => !s.err);
  const candidates: Candidate[] = [];

  for (let i = 0; i < infos.length && Date.now() - started < TIME_BUDGET_MS; i += CONCURRENCY) {
    const batch = infos.slice(i, i + CONCURRENCY);
    const txs = await Promise.all(
      batch.map((s) => conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }))
    );
    txs.forEach((tx, idx) => {
      if (!tx?.meta || tx.meta.err) return;
      const derived = deriveTrade(
        {
          keys: tx.transaction.message.accountKeys.map((k) => ({ pubkey: k.pubkey.toBase58(), signer: k.signer })),
          preBalances: tx.meta.preBalances,
          postBalances: tx.meta.postBalances,
          preTokenBalances: tx.meta.preTokenBalances,
          postTokenBalances: tx.meta.postTokenBalances,
          fee: tx.meta.fee,
        },
        wallet
      );
      if (!derived) return;
      candidates.push({ ...derived, signature: batch[idx].signature, ts: (tx.blockTime || 0) * 1000 });
    });
  }

  let added = 0;
  if (candidates.length > 0) {
    const price = await solPriceUsd();
    if (price <= 0) throw new Error("No SOL price available to value the trades.");

    const mints = [...new Set(candidates.map((c) => c.mint))];
    const tickers = new Map<string, string>();
    for (const [mint, p] of await fetchPumpCoins(mints)) tickers.set(mint, p.symbol.toUpperCase());
    const rest = mints.filter((m) => !tickers.has(m));
    if (rest.length) {
      try {
        for (const p of await fetchDexTokensBatch(rest)) tickers.set(p.baseToken.address, p.baseToken.symbol.toUpperCase());
      } catch {
        // Falls back to a short mint below.
      }
    }

    const trades: LoggedTrade[] = candidates.map((c) => ({
      mint: c.mint,
      ticker: tickers.get(c.mint) || c.mint.slice(0, 4),
      side: c.side,
      solAmount: c.solAmount,
      tokenAmount: c.tokenAmount,
      solPriceUsdAtTrade: price,
      signature: c.signature,
      ts: c.ts,
      estimated: true,
    }));

    added = await addEstimatedTrades(wallet, trades);
  }

  // Only reached when the whole history read succeeded.
  await setBackfillMark(wallet, Date.now());
  return added;
}
