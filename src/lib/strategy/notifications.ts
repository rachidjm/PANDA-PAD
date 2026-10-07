import type { StrategyRecord } from "./types";

/**
 * The notification bell's own history: one entry per leg that has actually EXECUTED (a real signature, read
 * back from Jupiter by sync() — never a guess), derived straight from the strategies the server already
 * stores. Nothing new is persisted for the history itself; only which ones have been SEEN is (client-side,
 * see useStrategyNotifications.ts) — the records themselves are the source of truth.
 */

export type StrategyNotification = {
  /** Stable across re-fetches: `${record.id}:buy` / `${record.id}:sell`, so the same fill is never duplicated. */
  id: string;
  strategyId: string;
  kind: "buy" | "sell";
  mint: string;
  ticker: string;
  /** The price it actually filled at. */
  priceUsd: number;
  /** When PANDA last confirmed this (the record's own `updatedAt`) — Jupiter doesn't hand back a per-leg fill time. */
  at: number;
};

/** Every executed leg across every saved strategy, newest first. A leg with no signature yet never appears —
 *  this is for what has REALLY happened, not what is still waiting. */
export function deriveNotifications(records: StrategyRecord[]): StrategyNotification[] {
  const out: StrategyNotification[] = [];
  for (const r of records) {
    if (r.buySignature && r.buyUsd !== undefined) {
      out.push({ id: `${r.id}:buy`, strategyId: r.id, kind: "buy", mint: r.mint, ticker: r.ticker, priceUsd: r.buyUsd, at: r.updatedAt });
    }
    if (r.sellSignature) {
      // A stop loss fills at the stop price, a take-profit at the sell target — whichever actually happened.
      const price = r.sellKind === "stop_loss" ? r.stopUsd : r.sellUsd;
      if (price !== undefined) out.push({ id: `${r.id}:sell`, strategyId: r.id, kind: "sell", mint: r.mint, ticker: r.ticker, priceUsd: price, at: r.updatedAt });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** How many of `all` are newer than `lastSeenAt` (0 = everything has been seen, or there's no cursor yet and nothing exists). */
export function countUnread(all: StrategyNotification[], lastSeenAt: number): number {
  return all.filter((n) => n.at > lastSeenAt).length;
}
