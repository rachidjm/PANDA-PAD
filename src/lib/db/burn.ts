import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { burnAccruals, burnTransactions } from "./schema";

/**
 * The burn ledger (src/lib/burn). Two facts per coin, both taken from the chain: what its Burn share paid the burn
 * wallet (burn_accruals, one row per fee distribution) and what the wallet spent and burned for it
 * (burn_transactions, one row per transaction it sent). What is left to spend is the first minus the second.
 */

/** Books what one fee distribution paid the burn wallet for a coin. False if that transaction was already booked. */
export async function pgAccrueBurn(db: Db, a: { sourceSig: string; mint: string; lamports: number }): Promise<boolean> {
  if (!Number.isSafeInteger(a.lamports) || a.lamports <= 0) return false;
  const rows = await db.insert(burnAccruals).values(a).onConflictDoNothing().returning({ sig: burnAccruals.sourceSig });
  return rows.length > 0;
}

/** Of these signatures, the ones the ledger already knows (a booked distribution, or a transaction the burn wallet sent). */
export async function pgKnownBurnSignatures(db: Db, signatures: readonly string[]): Promise<Set<string>> {
  if (signatures.length === 0) return new Set();
  const [a, t] = await Promise.all([
    db.select({ s: burnAccruals.sourceSig }).from(burnAccruals).where(inArray(burnAccruals.sourceSig, [...signatures])),
    db.select({ s: burnTransactions.signature }).from(burnTransactions).where(inArray(burnTransactions.signature, [...signatures])),
  ]);
  return new Set([...a, ...t].map((r) => r.s));
}

export type BurnBalance = { mint: string; accruedLamports: number; spentLamports: number; pendingLamports: number };

/**
 * Per coin: received, spent (confirmed transactions at their real cost, and "sent" ones at the most they can cost — so
 * SOL that is on its way out is never counted as still there) and what is left.
 */
export async function pgBurnBalances(db: Db, mint?: string): Promise<BurnBalance[]> {
  const accrued = await db
    .select({ mint: burnAccruals.mint, n: sql<string>`COALESCE(SUM(${burnAccruals.lamports}), 0)` })
    .from(burnAccruals)
    .where(mint ? eq(burnAccruals.mint, mint) : undefined)
    .groupBy(burnAccruals.mint);
  const spent = await db
    .select({ mint: burnTransactions.mint, n: sql<string>`COALESCE(SUM(${burnTransactions.lamports}), 0)` })
    .from(burnTransactions)
    .where(and(inArray(burnTransactions.status, ["sent", "confirmed"]), mint ? eq(burnTransactions.mint, mint) : undefined))
    .groupBy(burnTransactions.mint);
  const out = new Map<string, BurnBalance>();
  for (const r of accrued) out.set(r.mint, { mint: r.mint, accruedLamports: Number(r.n), spentLamports: 0, pendingLamports: Number(r.n) });
  for (const r of spent) {
    const b = out.get(r.mint) ?? { mint: r.mint, accruedLamports: 0, spentLamports: 0, pendingLamports: 0 };
    b.spentLamports = Number(r.n);
    b.pendingLamports = b.accruedLamports - b.spentLamports;
    out.set(r.mint, b);
  }
  return [...out.values()];
}

/** Written BEFORE the transaction is sent, with the most it can cost: a crash right after sending still leaves a trace to resolve. */
export async function pgRecordBurnTx(db: Db, t: { signature: string; mint: string; kind: "buy" | "burn"; reservedLamports: number; tokens?: string; decimals?: number }): Promise<void> {
  await db.insert(burnTransactions).values({ signature: t.signature, mint: t.mint, kind: t.kind, status: "sent", lamports: Math.max(0, Math.round(t.reservedLamports)), tokens: t.tokens ?? null, decimals: t.decimals ?? null });
}

/** The outcome, from the chain: confirmed at its real cost (which can be negative for a burn that got rent back), or failed (nothing was spent). */
export async function pgSettleBurnTx(db: Db, signature: string, o: { status: "confirmed"; lamports: number } | { status: "failed" }): Promise<void> {
  await db
    .update(burnTransactions)
    .set(o.status === "confirmed" ? { status: "confirmed", lamports: Math.round(o.lamports), confirmedAt: new Date() } : { status: "failed", lamports: 0 })
    .where(and(eq(burnTransactions.signature, signature), eq(burnTransactions.status, "sent")));
}

export type BurnTxRow = typeof burnTransactions.$inferSelect;

/** Transactions sent whose outcome isn't recorded yet. */
export async function pgOpenBurnTxs(db: Db): Promise<BurnTxRow[]> {
  return db.select().from(burnTransactions).where(eq(burnTransactions.status, "sent"));
}

export type BurnSummary = { mint: string; tokensBurned: string; decimals: number | null; lamportsSpent: number; burns: number; recent: { signature: string; tokens: string; at: number }[] };

/** What a coin's page shows: the total burned (raw, as a string), the SOL its buys cost and its latest burns. Confirmed transactions only. */
export async function pgBurnSummary(db: Db, mint: string): Promise<BurnSummary> {
  const rows = await db
    .select()
    .from(burnTransactions)
    .where(and(eq(burnTransactions.mint, mint), eq(burnTransactions.status, "confirmed")))
    .orderBy(desc(burnTransactions.confirmedAt));
  const burns = rows.filter((r) => r.kind === "burn" && r.tokens);
  let total = BigInt(0);
  for (const b of burns) total += BigInt(b.tokens!);
  return {
    mint,
    tokensBurned: total.toString(),
    decimals: burns.find((b) => b.decimals !== null)?.decimals ?? null,
    lamportsSpent: rows.filter((r) => r.kind === "buy").reduce((s, r) => s + r.lamports, 0),
    burns: burns.length,
    recent: burns.slice(0, 5).map((b) => ({ signature: b.signature, tokens: b.tokens!, at: (b.confirmedAt ?? b.createdAt).getTime() })),
  };
}

/** Confirmed burns no Telegram digest has included yet, oldest first — with the SOL of that coin's buys not yet reported. */
export async function pgBurnsToPost(db: Db): Promise<{ burns: BurnTxRow[]; buys: BurnTxRow[] }> {
  const rows = await db
    .select()
    .from(burnTransactions)
    .where(and(eq(burnTransactions.status, "confirmed"), isNull(burnTransactions.postedAt)))
    .orderBy(burnTransactions.confirmedAt);
  return { burns: rows.filter((r) => r.kind === "burn"), buys: rows.filter((r) => r.kind === "buy") };
}

export async function pgMarkBurnsPosted(db: Db, signatures: readonly string[], now: number): Promise<void> {
  if (signatures.length === 0) return;
  await db
    .update(burnTransactions)
    .set({ postedAt: new Date(now) })
    .where(inArray(burnTransactions.signature, [...signatures]));
}
