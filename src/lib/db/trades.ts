import { asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { backfillMarks, trades } from "./schema";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";

/** A wallet's trade log in Postgres: same order as the Blob array (insertion order), one row per (wallet, signature). */

const toRow = (wallet: string, t: LoggedTrade) => ({
  wallet,
  signature: t.signature,
  mint: t.mint,
  ticker: t.ticker,
  side: t.side,
  solAmount: t.solAmount,
  tokenAmount: t.tokenAmount,
  solPriceUsdAtTrade: t.solPriceUsdAtTrade,
  ts: t.ts,
  estimated: t.estimated === true,
});

export async function pgGetTrades(db: Db, wallet: string): Promise<LoggedTrade[]> {
  const rows = await db.select().from(trades).where(eq(trades.wallet, wallet)).orderBy(asc(trades.seq));
  return rows.map((r) => ({
    mint: r.mint,
    ticker: r.ticker,
    side: r.side as "buy" | "sell",
    solAmount: r.solAmount,
    tokenAmount: r.tokenAmount,
    solPriceUsdAtTrade: r.solPriceUsdAtTrade,
    signature: r.signature,
    ts: r.ts,
    ...(r.estimated ? { estimated: true } : {}),
  }));
}

/** Appends trades that aren't logged yet (in the order given). Returns how many were new. */
export async function pgAddTrades(db: Db, wallet: string, list: LoggedTrade[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < list.length; i += 200) {
    const rows = await db.insert(trades).values(list.slice(i, i + 200).map((t) => toRow(wallet, t))).onConflictDoNothing().returning({ signature: trades.signature });
    added += rows.length;
  }
  return added;
}

export async function pgGetBackfillMark(db: Db, wallet: string): Promise<{ at: number } | null> {
  const [row] = await db.select().from(backfillMarks).where(eq(backfillMarks.wallet, wallet));
  return row ? { at: row.at } : null;
}

export async function pgSetBackfillMark(db: Db, wallet: string, at: number): Promise<void> {
  await db.insert(backfillMarks).values({ wallet, at }).onConflictDoUpdate({ target: backfillMarks.wallet, set: { at } });
}

/** Cheap existence check (uses the `trades_wallet_seq` index) — used by the "apply a code before your first
 *  trade" rule (src/lib/referrals/bind.ts's `tryApplyRecruiterCode`), never fetches the trade rows themselves. */
export async function pgHasAnyTrade(db: Db, wallet: string): Promise<boolean> {
  const [row] = await db.select({ seq: trades.seq }).from(trades).where(eq(trades.wallet, wallet)).limit(1);
  return !!row;
}

/** Every distinct wallet with at least one trade, right now — used ONLY by scripts/backfill-legacy-fee-wallets.ts
 *  for its one-time snapshot (see legacy_fee_wallets in schema.ts). Never called from request-serving code. */
export async function pgDistinctTradeWallets(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ wallet: trades.wallet }).from(trades);
  return rows.map((r) => r.wallet);
}
