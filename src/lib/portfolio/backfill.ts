import { Connection, PublicKey } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { solPriceUsd } from "@/lib/solana/prices";
import { fetchPumpCoins } from "@/lib/pump/frontend-api";
import { fetchDexTokensBatch } from "@/lib/dexscreener/client";
import { readJson, writeJson, updateJson } from "@/lib/rewards/blob-store";
import { LoggedTrade } from "./trade-log";
import { deriveTrade } from "./derive-trade";

const SIGNATURE_LIMIT = 80;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 22_000;
const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000;
const markerPath = (wallet: string) => `portfolio/backfill/${wallet}.json`;
const tradesPath = (wallet: string) => `portfolio/trades/${wallet}.json`;

/** True if this wallet's on-chain history hasn't been scanned yet (or not in the last day). */
export async function needsBackfill(wallet: string): Promise<boolean> {
  const marker = await readJson<{ at: number } | null>(markerPath(wallet), null);
  return !marker || Date.now() - marker.at > RESCAN_AFTER_MS;
}

type Candidate = { mint: string; side: "buy" | "sell"; solAmount: number; tokenAmount: number; signature: string; ts: number };

/**
 * Reads the wallet's recent on-chain history and turns each SOL⇄token swap
 * into a logged trade, so Portfolio can show positions for trades made
 * OUTSIDE PANDA too. These are estimates, and are stored flagged as such:
 *  - only the last ~80 transactions are scanned;
 *  - only swaps against SOL (not USDC/USDT) are recognised;
 *  - the SOL amount is the wallet's net SOL change (includes the network fee
 *    and any account rent), and USD uses TODAY's SOL price, not the price at the time.
 * Returns how many new trades were added. Throws if the RPC can't be read
 * (in which case nothing is marked as scanned, so it retries later).
 */
export async function backfillTrades(wallet: string): Promise<number> {
  const started = Date.now();
  const conn = new Connection(serverRpcUrl(), "confirmed");
  const owner = new PublicKey(wallet);

  const infos = (await conn.getSignaturesForAddress(owner, { limit: SIGNATURE_LIMIT })).filter((s) => !s.err);
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

    added = await updateJson<LoggedTrade[], number>(tradesPath(wallet), [], (existing) => {
      const known = new Set(existing.map((t) => t.signature));
      const fresh = trades.filter((t) => !known.has(t.signature));
      return { next: [...existing, ...fresh], result: fresh.length };
    });
  }

  // Only reached when the whole history read succeeded.
  await writeJson(markerPath(wallet), { at: Date.now() });
  return added;
}
