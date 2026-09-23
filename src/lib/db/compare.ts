import { eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import type { BlobSource } from "./source";
import type { Domain } from "./mode";
import { pgGetLedger, pgGetPayoutDay, pgGetRegisteredMints, pgOpenClaims } from "./rewards";
import { pgGetTrades, pgGetBackfillMark } from "./trades";
import { pgReadTotal } from "./activity";
import { pgGetPauseState } from "./pause";
import { activityEvents, economyDaily, rewardCredits, rewardLedgers } from "./schema";
import { METRIC_KEYS } from "@/lib/economy/rollup";
import { SUBSYSTEMS } from "@/lib/protocol/pause";

/**
 * Read-only comparison of Blob and Postgres, domain by domain (docs/PHASE6_PLAN.md §1.4, step 3). It writes nothing anywhere.
 * `differences` is empty when they agree; `warnings` are things that aren't a mismatch but need a human (a payout that was sent and
 * has no recorded outcome). Run it daily during "dual" and before switching a domain to "postgres".
 */
export type CompareReport = { domain: Domain; checked: number; differences: string[]; warnings: string[] };

const MAX_LISTED = 25;
const cap = (list: string[]) => (list.length > MAX_LISTED ? [...list.slice(0, MAX_LISTED), `… and ${list.length - MAX_LISTED} more`] : list);
const eq2 = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function compare(db: Db, source: BlobSource, domains: Domain[]): Promise<CompareReport[]> {
  const out: CompareReport[] = [];

  if (domains.includes("rewards")) {
    const diffs: string[] = [];
    const warnings: string[] = [];
    let checked = 0;
    const blobMints = await source.registry();
    const pgMints = await pgGetRegisteredMints(db);
    for (const m of blobMints) if (!pgMints.includes(m)) diffs.push(`registry: ${m} is in Blob but not in Postgres`);
    for (const m of pgMints) if (!blobMints.includes(m)) diffs.push(`registry: ${m} is in Postgres but not in Blob`);
    const mints = [...new Set([...blobMints, ...pgMints])];
    for (const mint of mints) {
      checked++;
      const blob = await source.ledger(mint);
      const pg = await pgGetLedger(db, mint);
      if (blob.totalDistributedLamports !== pg.totalDistributedLamports) diffs.push(`${mint}: distributed Blob ${blob.totalDistributedLamports} vs Postgres ${pg.totalDistributedLamports}`);
      if ((blob.dustLamports ?? 0) !== (pg.dustLamports ?? 0)) diffs.push(`${mint}: dust Blob ${blob.dustLamports ?? 0} vs Postgres ${pg.dustLamports ?? 0}`);
      for (const wallet of new Set([...Object.keys(blob.holders), ...Object.keys(pg.holders)])) {
        const a = blob.holders[wallet];
        const b = pg.holders[wallet];
        if (!a || !b) diffs.push(`${mint}/${wallet}: only in ${a ? "Blob" : "Postgres"}`);
        else if (a.entitledLamports !== b.entitledLamports || a.claimedLamports !== b.claimedLamports) {
          diffs.push(`${mint}/${wallet}: entitled ${a.entitledLamports}/${b.entitledLamports}, claimed ${a.claimedLamports}/${b.claimedLamports} (Blob/Postgres)`);
        }
      }
      // Postgres' own consistency: the credit rows must add up to what the balances say was credited.
      const [ledgerRow] = await db.select().from(rewardLedgers).where(eq(rewardLedgers.mint, mint));
      if (ledgerRow) {
        const credits = await db.select().from(rewardCredits).where(eq(rewardCredits.mint, mint));
        const sum = credits.reduce((s, c) => s + c.lamports, 0);
        const entitled = Object.values(pg.holders).reduce((s, h) => s + h.entitledLamports, 0);
        if (sum !== entitled) diffs.push(`${mint}: Postgres credit rows add up to ${sum} but balances say ${entitled}`);
        if (entitled + (ledgerRow.dustLamports ?? 0) !== ledgerRow.totalDistributedLamports) diffs.push(`${mint}: Postgres entitled + dust != distributed`);
      }
    }
    const day = await source.payoutDay();
    if (day) {
      checked++;
      const pgPaid = await pgGetPayoutDay(db, day.date);
      if (pgPaid !== day.lamports) diffs.push(`payout day ${day.date}: Blob ${day.lamports} vs Postgres ${pgPaid}`);
    }
    for (const c of await pgOpenClaims(db)) {
      if (c.status === "sent" || Date.now() - c.createdAt.getTime() > 10 * 60_000) warnings.push(`claim ${c.id} (${c.lamports} lamports to ${c.wallet}) is "${c.status}" with no recorded outcome${c.signature ? `, signature ${c.signature}` : ""}: check it on-chain`);
    }
    out.push({ domain: "rewards", checked, differences: cap(diffs), warnings: cap(warnings) });
  }

  if (domains.includes("trades")) {
    const diffs: string[] = [];
    const wallets = await source.tradeWallets();
    for (const wallet of wallets) {
      const blob = await source.trades(wallet);
      const pg = await pgGetTrades(db, wallet);
      if (!eq2(blob, pg)) diffs.push(`${wallet}: Blob has ${blob.length} trades, Postgres ${pg.length}${blob.length === pg.length ? " (same count, different content or order)" : ""}`);
    }
    for (const m of await source.backfillMarks()) {
      const pg = await pgGetBackfillMark(db, m.wallet);
      if (pg?.at !== m.at) diffs.push(`scan marker of ${m.wallet}: Blob ${m.at} vs Postgres ${pg?.at ?? "none"}`);
    }
    out.push({ domain: "trades", checked: wallets.length, differences: cap(diffs), warnings: [] });
  }

  if (domains.includes("activity")) {
    const diffs: string[] = [];
    let checked = 0;
    const journal = await source.journal();
    const blobIds = new Map<string, string>();
    for (const { day, events } of journal) for (const e of events) blobIds.set(e.id, day);
    const ids = [...blobIds.keys()];
    const pgRows = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) for (const r of await db.select({ id: activityEvents.id, day: activityEvents.recordedDay }).from(activityEvents).where(inArray(activityEvents.id, ids.slice(i, i + 500)))) pgRows.set(r.id, r.day);
    for (const [id, day] of blobIds) {
      checked++;
      if (!pgRows.has(id)) diffs.push(`event ${id} (${day}) is in Blob but not in Postgres`);
    }
    // Events only in Postgres are expected once the domain is in "postgres" mode; in "dual" they mean a Blob write was lost.
    const total = await source.economyTotal();
    if (total) {
      checked++;
      const pg = await pgReadTotal(db);
      for (const k of METRIC_KEYS) if ((total.metrics[k] ?? 0) !== pg.metrics[k]) diffs.push(`economy total ${k}: Blob ${total.metrics[k] ?? 0} vs Postgres ${pg.metrics[k]}`);
      if (total.since !== pg.since) diffs.push(`economy total since: Blob ${total.since} vs Postgres ${pg.since}`);
    }
    for (const d of await source.economyDays()) {
      checked++;
      const [row] = await db.select().from(economyDaily).where(eq(economyDaily.day, d.day));
      for (const k of METRIC_KEYS) if ((d.metrics[k] ?? 0) !== (row?.[k] ?? 0)) diffs.push(`economy ${d.day} ${k}: Blob ${d.metrics[k] ?? 0} vs Postgres ${row?.[k] ?? 0}`);
    }
    out.push({ domain: "activity", checked, differences: cap(diffs), warnings: [] });
  }

  if (domains.includes("pause")) {
    const diffs: string[] = [];
    const blob = await source.pause();
    const pg = await pgGetPauseState(db);
    for (const s of SUBSYSTEMS) {
      const a = blob.subsystems[s];
      const b = pg.subsystems[s];
      if (!eq2(a ?? null, b ?? null)) diffs.push(`${s}: Blob ${JSON.stringify(a ?? null)} vs Postgres ${JSON.stringify(b ?? null)}`);
    }
    out.push({ domain: "pause", checked: SUBSYSTEMS.length, differences: diffs, warnings: [] });
  }

  return out;
}
