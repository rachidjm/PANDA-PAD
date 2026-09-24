import { eq } from "drizzle-orm";
import type { Db } from "./client";
import {
  activityEvents, backfillMarks, economyDaily, economyTotal, payoutDays, protocolPause, rewardBalances, rewardCredits, rewardDistributions, rewardLedgers, rewardRegistry, trades,
} from "./schema";
import type { BlobSource } from "./source";
import type { Domain } from "./mode";
import type { Ledger } from "@/lib/rewards/ledger";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import { METRIC_KEYS } from "@/lib/economy/rollup";
import { pgImportAudit } from "./audit";

/**
 * Copies what Blob holds into Postgres, one domain at a time (docs/PHASE6_PLAN.md §1.4, step 4).
 *
 * It is a RE-SNAPSHOT, so it is safe to run again: for the things it imports, Postgres ends up equal to Blob whatever it held
 * before (a coin's ledger, a wallet's trade log… are deleted and rewritten in one transaction each). That is only correct while
 * nothing writes to Blob in between, which is why the script refuses to run unless the money domains are paused (see
 * scripts/db-backfill.ts) and why the order is: pause → backfill → switch to "dual" → unpause.
 *
 * Nothing is ever written to Blob. Anything that can't be imported without changing its meaning (a holder whose claimed
 * amount exceeds what was credited, which the database's CHECK forbids) is reported in `problems` and NOT silently clamped.
 */

export type BackfillReport = { domain: Domain; imported: Record<string, number>; problems: string[] };

/** Rewrites one coin's whole ledger as an opening snapshot: totals, dust, and one opening credit + balance per holder. */
export async function importLedger(db: Db, ledger: Ledger): Promise<{ holders: number; problems: string[] }> {
  const problems: string[] = [];
  const mint = ledger.mint;
  const rows = Object.entries(ledger.holders);
  for (const [wallet, h] of rows) {
    if (![h.entitledLamports, h.claimedLamports].every(Number.isSafeInteger) || h.entitledLamports < 0 || h.claimedLamports < 0) problems.push(`${mint}/${wallet}: non-integer or negative amount`);
    else if (h.claimedLamports > h.entitledLamports) problems.push(`${mint}/${wallet}: claimed ${h.claimedLamports} exceeds entitled ${h.entitledLamports}`);
  }
  const credited = rows.reduce((s, [, h]) => s + h.entitledLamports, 0);
  const dust = ledger.dustLamports ?? 0;
  if (credited + dust !== ledger.totalDistributedLamports) problems.push(`${mint}: entitled ${credited} + dust ${dust} != distributed ${ledger.totalDistributedLamports} (the Blob ledger already breaks its own invariant)`);
  if (problems.length) return { holders: 0, problems }; // import a coin whole or not at all

  await db.transaction(async (tx) => {
    await tx.delete(rewardCredits).where(eq(rewardCredits.mint, mint));
    await tx.delete(rewardDistributions).where(eq(rewardDistributions.mint, mint));
    await tx.delete(rewardBalances).where(eq(rewardBalances.mint, mint));
    await tx.delete(rewardLedgers).where(eq(rewardLedgers.mint, mint));
    await tx.insert(rewardLedgers).values({ mint, totalDistributedLamports: ledger.totalDistributedLamports, dustLamports: dust });
    const opening = `backfill:${mint}`;
    await tx.insert(rewardDistributions).values({ sourceSig: opening, mint, distributedLamports: ledger.totalDistributedLamports, dustLamports: dust });
    const withCredit = rows.filter(([, h]) => h.entitledLamports > 0);
    for (let i = 0; i < withCredit.length; i += 500) {
      const chunk = withCredit.slice(i, i + 500);
      await tx.insert(rewardCredits).values(chunk.map(([wallet, h]) => ({ mint, wallet, lamports: h.entitledLamports, sourceSig: opening })));
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      // Blob never distinguished "reserved" from "paid": everything it counts as claimed is imported as claimed (the domain is paused, so nothing is in flight).
      await tx.insert(rewardBalances).values(chunk.map(([wallet, h]) => ({ mint, wallet, creditedLamports: h.entitledLamports, reservedLamports: 0, claimedLamports: h.claimedLamports })));
    }
  });
  return { holders: rows.length, problems };
}

export async function importTrades(db: Db, wallet: string, list: LoggedTrade[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(trades).where(eq(trades.wallet, wallet));
    const seen = new Set<string>();
    const unique = list.filter((t) => (seen.has(t.signature) ? false : (seen.add(t.signature), true)));
    for (let i = 0; i < unique.length; i += 200) {
      await tx.insert(trades).values(
        unique.slice(i, i + 200).map((t) => ({
          wallet, signature: t.signature, mint: t.mint, ticker: t.ticker, side: t.side, solAmount: t.solAmount, tokenAmount: t.tokenAmount,
          solPriceUsdAtTrade: t.solPriceUsdAtTrade, ts: t.ts, estimated: t.estimated === true,
        }))
      );
    }
  });
}

export async function backfill(db: Db, source: BlobSource, domains: Domain[], log: (line: string) => void = () => {}): Promise<BackfillReport[]> {
  const reports: BackfillReport[] = [];

  if (domains.includes("rewards")) {
    const r: BackfillReport = { domain: "rewards", imported: {}, problems: [] };
    const mints = await source.registry();
    if (mints.length) await db.insert(rewardRegistry).values(mints.map((mint) => ({ mint }))).onConflictDoNothing();
    r.imported.registry = mints.length;
    let holders = 0;
    for (const mint of mints) {
      const res = await importLedger(db, { ...(await source.ledger(mint)), mint });
      holders += res.holders;
      r.problems.push(...res.problems);
    }
    r.imported.ledgers = mints.length;
    r.imported.holders = holders;
    const day = await source.payoutDay();
    if (day) {
      await db.insert(payoutDays).values({ day: day.date, paidLamports: day.lamports }).onConflictDoUpdate({ target: payoutDays.day, set: { paidLamports: day.lamports } });
      r.imported.payoutDays = 1;
    }
    log(`rewards: ${mints.length} coins, ${holders} holders, ${r.problems.length} problems`);
    reports.push(r);
  }

  if (domains.includes("trades")) {
    const r: BackfillReport = { domain: "trades", imported: {}, problems: [] };
    const wallets = await source.tradeWallets();
    let count = 0;
    for (const wallet of wallets) {
      const list = await source.trades(wallet);
      await importTrades(db, wallet, list);
      count += list.length;
    }
    const marks = await source.backfillMarks();
    for (const m of marks) await db.insert(backfillMarks).values(m).onConflictDoUpdate({ target: backfillMarks.wallet, set: { at: m.at } });
    r.imported = { wallets: wallets.length, trades: count, markers: marks.length };
    log(`trades: ${wallets.length} wallets, ${count} trades, ${marks.length} scan markers`);
    reports.push(r);
  }

  if (domains.includes("activity")) {
    const r: BackfillReport = { domain: "activity", imported: {}, problems: [] };
    let events = 0;
    for (const { day, events: list } of await source.journal()) {
      for (let i = 0; i < list.length; i += 200) {
        const rows = list.slice(i, i + 200).map((e) => ({
          id: e.id, kind: e.kind, ts: e.ts, mint: e.mint, wallet: e.wallet ?? null, lamports: e.lamports ?? null, tokenAmount: e.tokenAmount ?? null,
          signature: e.signature ?? null, verified: e.verified === true, recordedDay: day,
        }));
        const done = await db.insert(activityEvents).values(rows).onConflictDoNothing().returning({ id: activityEvents.id });
        events += done.length;
      }
    }
    const days = await source.economyDays();
    for (const d of days) {
      const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, d.metrics[k] ?? 0]));
      await db.insert(economyDaily).values({ day: d.day, ...values }).onConflictDoUpdate({ target: economyDaily.day, set: values });
    }
    const total = await source.economyTotal();
    if (total) {
      const values = Object.fromEntries(METRIC_KEYS.map((k) => [k, total.metrics[k] ?? 0]));
      await db.insert(economyTotal).values({ id: 1, since: total.since, ...values }).onConflictDoUpdate({ target: economyTotal.id, set: { since: total.since, ...values } });
    }
    r.imported = { events, economyDays: days.length, total: total ? 1 : 0 };
    log(`activity: ${events} events, ${days.length} economy days${total ? ", totals" : ""}`);
    reports.push(r);
  }

  if (domains.includes("pause")) {
    const r: BackfillReport = { domain: "pause", imported: {}, problems: [] };
    const state = await source.pause();
    const entries = Object.entries(state.subsystems);
    for (const [subsystem, e] of entries) {
      if (!e) continue;
      await db.insert(protocolPause).values({ subsystem, paused: e.paused, reason: e.reason, since: e.since, byWallet: e.by }).onConflictDoUpdate({ target: protocolPause.subsystem, set: { paused: e.paused, reason: e.reason, since: e.since, byWallet: e.by } });
    }
    r.imported = { subsystems: entries.length };
    log(`pause: ${entries.length} switches`);
    reports.push(r);
  }

  if (domains.includes("audit")) {
    const r: BackfillReport = { domain: "audit", imported: {}, problems: [] };
    const events = await source.audit();
    const added = await pgImportAudit(db, events);
    r.imported = { events: events.length, added };
    log(`audit: ${events.length} events in Blob, ${added} added to the hash chain`);
    reports.push(r);
  }

  return reports;
}
