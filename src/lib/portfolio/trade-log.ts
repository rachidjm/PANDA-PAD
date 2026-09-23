import { readJson, updateJson, writeJson } from "@/lib/rewards/blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgAddTrades, pgGetBackfillMark, pgGetTrades, pgSetBackfillMark } from "@/lib/db/trades";

export type LoggedTrade = {
  mint: string;
  ticker: string;
  side: "buy" | "sell";
  /** Real SOL amount that changed hands in this trade (exact — from the trade itself, not estimated). */
  solAmount: number;
  /** Real token amount, in UI units. */
  tokenAmount: number;
  /** Real SOL/USD price at the moment this trade was recorded — lets P&L be computed in USD without
   *  guessing a historical rate later. */
  solPriceUsdAtTrade: number;
  signature: string;
  ts: number;
  /** True when read back from on-chain history (approximate) rather than logged live by PANDA. */
  estimated?: boolean;
};

function tradeLogPath(wallet: string): string {
  return `portfolio/trades/${wallet}.json`;
}

const markerPath = (wallet: string) => `portfolio/backfill/${wallet}.json`;

// Where these live (Blob, Blob + Postgres, or Postgres) is per PANDA_STORAGE_MODES — see src/lib/db/mode.ts.

export async function getTrades(wallet: string): Promise<LoggedTrade[]> {
  if (storageMode("trades") === "postgres") return pgGetTrades(getDb(), wallet);
  return readJson<LoggedTrade[]>(tradeLogPath(wallet), []);
}

/** Appends one real, already-confirmed trade — see src/app/api/portfolio/record-trade/route.ts for the
 *  on-chain verification that happens before this is ever called. */
export async function recordTrade(wallet: string, trade: LoggedTrade): Promise<void> {
  const mode = storageMode("trades");
  if (mode === "postgres") {
    await pgAddTrades(getDb(), wallet, [trade]);
    return;
  }
  await updateJson<LoggedTrade[], void>(tradeLogPath(wallet), [], (trades) => {
    if (!trades.some((t) => t.signature === trade.signature)) trades.push(trade); // else already recorded
    return { next: trades, result: undefined };
  });
  if (mode === "dual") await mirror("trades", `trade ${trade.signature}`, () => pgAddTrades(getDb(), wallet, [trade]));
}

/** Adds the trades a backfill scan found that aren't logged yet. Returns how many were new. */
export async function addEstimatedTrades(wallet: string, trades: LoggedTrade[]): Promise<number> {
  const mode = storageMode("trades");
  if (mode === "postgres") return pgAddTrades(getDb(), wallet, trades);
  const fresh = await updateJson<LoggedTrade[], LoggedTrade[]>(tradeLogPath(wallet), [], (existing) => {
    const known = new Set(existing.map((t) => t.signature));
    const add = trades.filter((t) => !known.has(t.signature));
    return { next: [...existing, ...add], result: add };
  });
  if (mode === "dual" && fresh.length > 0) await mirror("trades", `backfill ${wallet}`, () => pgAddTrades(getDb(), wallet, fresh));
  return fresh.length;
}

/** When this wallet's on-chain history was last scanned (null = never). */
export async function getBackfillMark(wallet: string): Promise<{ at: number } | null> {
  if (storageMode("trades") === "postgres") return pgGetBackfillMark(getDb(), wallet);
  return readJson<{ at: number } | null>(markerPath(wallet), null);
}

export async function setBackfillMark(wallet: string, at: number): Promise<void> {
  const mode = storageMode("trades");
  if (mode === "postgres") {
    await pgSetBackfillMark(getDb(), wallet, at);
    return;
  }
  await writeJson(markerPath(wallet), { at });
  if (mode === "dual") await mirror("trades", `marker ${wallet}`, () => pgSetBackfillMark(getDb(), wallet, at));
}
