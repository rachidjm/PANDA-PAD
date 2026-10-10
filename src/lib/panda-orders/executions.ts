import type { LoggedTrade } from "@/lib/portfolio/trade-log";

/**
 * An executed PANDA order is a real sale on chain: it belongs in the wallet's trade log like any sell made by hand, so
 * that it counts in the portfolio and shows on the coin's chart at the time and price it REALLY executed (never the
 * price the user drew). Everything comes from the confirmed transaction itself: what the wallet received, the tokens
 * that left it, and the block's time.
 */

export type ExecutedOrder = { wallet: string; mint: string; ticker: string; signature: string | null; state: string; executedAt: number | null };
export type TxFacts = { solAmount: number; tokenAmount: number; blockTimeMs: number | null };

export type ExecutionDeps = {
  now: () => number;
  getTrades: (wallet: string) => Promise<LoggedTrade[]>;
  recordTrade: (wallet: string, trade: LoggedTrade) => Promise<void>;
  /** What the confirmed transaction did for this wallet and coin; null if it can't be read (yet) or wasn't a sale of it. */
  txFacts: (signature: string, wallet: string, mint: string) => Promise<TxFacts | null>;
  solUsd: () => Promise<number>;
};

/** A SOL price read more than this long after the sale is only an estimate of the one at that moment. */
export const FRESH_PRICE_MS = 10 * 60_000;
export const MAX_PER_CALL = 5;

/** Logs every executed order that isn't in its wallet's trade log yet. Idempotent (by signature); returns how many were added. */
export async function logExecutions(deps: ExecutionDeps, orders: ExecutedOrder[]): Promise<number> {
  const executed = orders.filter((o): o is ExecutedOrder & { signature: string } => o.state === "executed" && !!o.signature);
  if (executed.length === 0) return 0;
  let added = 0;
  let solUsd: number | null = null;
  const logged = new Map<string, Set<string>>();
  for (const o of executed) {
    if (added >= MAX_PER_CALL) break;
    if (!logged.has(o.wallet)) logged.set(o.wallet, new Set((await deps.getTrades(o.wallet)).map((t) => t.signature)));
    const seen = logged.get(o.wallet)!;
    if (seen.has(o.signature)) continue;
    let facts: TxFacts | null = null;
    try {
      facts = await deps.txFacts(o.signature, o.wallet, o.mint);
    } catch {
      facts = null; // an RPC that can't read this transaction right now must not stop the others
    }
    if (!facts || !(facts.solAmount > 0) || !(facts.tokenAmount > 0)) continue; // not readable yet: tried again next time
    solUsd ??= await deps.solUsd();
    if (!(solUsd > 0)) return added; // no price to value it with right now
    const ts = facts.blockTimeMs ?? o.executedAt ?? deps.now();
    await deps.recordTrade(o.wallet, {
      mint: o.mint,
      ticker: o.ticker,
      side: "sell",
      solAmount: facts.solAmount,
      tokenAmount: facts.tokenAmount,
      solPriceUsdAtTrade: solUsd,
      signature: o.signature,
      ts,
      ...(deps.now() - ts > FRESH_PRICE_MS ? { estimated: true } : {}),
    });
    seen.add(o.signature);
    added++;
  }
  return added;
}
