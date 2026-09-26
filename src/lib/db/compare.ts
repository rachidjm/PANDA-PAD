import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import type { BlobSource } from "./source";
import type { Domain, StorageMode } from "./mode";
import { pgGetLedger, pgGetPayoutDay, pgGetRegisteredMints, pgOpenClaims } from "./rewards";
import { pgGetTrades, pgGetBackfillMark } from "./trades";
import { pgReadTotal } from "./activity";
import { pgGetPauseState } from "./pause";
import { activityEvents, auditEvents, authNonces, economyDaily, rewardCredits, rewardLedgers, sessions } from "./schema";
import { METRIC_KEYS } from "@/lib/economy/rollup";
import { pgVerifyChain } from "./audit";
import { pgLoadPending } from "./launch";
import { SUBSYSTEMS } from "@/lib/protocol/pause";

/**
 * Read-only comparison of Blob and Postgres, domain by domain (docs/PHASE6_PLAN.md §1.4, step 3). It writes nothing anywhere.
 * `differences` is empty when they agree; `warnings` are things that aren't a mismatch but need a human (a payout that was sent and
 * has no recorded outcome). Run it daily during "dual" and before switching a domain to "postgres".
 */
export type CompareReport = { domain: Domain; checked: number; differences: string[]; warnings: string[]; /** Expected and informational: in a "postgres" domain Blob is a frozen copy and Postgres is AHEAD of it. */ notes: string[] };

const MAX_LISTED = 25;
const cap = (list: string[]) => (list.length > MAX_LISTED ? [...list.slice(0, MAX_LISTED), `… and ${list.length - MAX_LISTED} more`] : list);
const eq2 = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `modes` (the deployment's PANDA_STORAGE_MODES): for a domain in "postgres" mode Blob is no longer written (a frozen copy), so Postgres being
 * AHEAD of it (newer trades, a later pause state, more audit events) is expected and reported as a note. What is still a difference there is
 * anything Blob holds that Postgres doesn't (a migration gap) or anything that looks newer in Blob (a write that went to Blob after the switch).
 */
export async function compare(db: Db, source: BlobSource, domains: Domain[], modes: Partial<Record<Domain, StorageMode>> = {}): Promise<CompareReport[]> {
  const out: CompareReport[] = [];
  const frozen = (d: Domain) => modes[d] === "postgres";

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
    out.push({ domain: "rewards", checked, differences: cap(diffs), warnings: cap(warnings), notes: [] });
  }

  if (domains.includes("trades")) {
    const diffs: string[] = [];
    const notes: string[] = [];
    const wallets = await source.tradeWallets();
    for (const wallet of wallets) {
      const blob = await source.trades(wallet);
      const pg = await pgGetTrades(db, wallet);
      if (eq2(blob, pg)) continue;
      const pgSigs = new Set(pg.map((t) => t.signature));
      const missing = blob.filter((t) => !pgSigs.has(t.signature));
      if (frozen("trades") && missing.length === 0 && pg.length >= blob.length) notes.push(`${wallet}: frozen Blob has ${blob.length} trades, Postgres ${pg.length} (${pg.length - blob.length} recorded since the switch)`);
      else diffs.push(`${wallet}: Blob has ${blob.length} trades, Postgres ${pg.length}${blob.length === pg.length ? " (same count, different content or order)" : ""}${missing.length ? ` — ${missing.length} only in Blob` : ""}`);
    }
    for (const m of await source.backfillMarks()) {
      const pg = await pgGetBackfillMark(db, m.wallet);
      if (pg?.at === m.at) continue;
      if (frozen("trades") && pg && pg.at >= m.at) notes.push(`scan marker of ${m.wallet}: Postgres is newer than the frozen Blob copy`);
      else diffs.push(`scan marker of ${m.wallet}: Blob ${m.at} vs Postgres ${pg?.at ?? "none"}`);
    }
    out.push({ domain: "trades", checked: wallets.length, differences: cap(diffs), warnings: [], notes: cap(notes) });
  }

  if (domains.includes("activity")) {
    const diffs: string[] = [];
    const notes: string[] = [];
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
      for (const k of METRIC_KEYS) {
        const a = total.metrics[k] ?? 0;
        if (a === pg.metrics[k]) continue;
        if (frozen("activity") && pg.metrics[k] >= a) notes.push(`economy total ${k}: frozen Blob ${a}, Postgres ${pg.metrics[k]}`);
        else diffs.push(`economy total ${k}: Blob ${a} vs Postgres ${pg.metrics[k]}`);
      }
      if (total.since !== pg.since) diffs.push(`economy total since: Blob ${total.since} vs Postgres ${pg.since}`);
    }
    for (const d of await source.economyDays()) {
      checked++;
      const [row] = await db.select().from(economyDaily).where(eq(economyDaily.day, d.day));
      for (const k of METRIC_KEYS) {
        const a = d.metrics[k] ?? 0;
        const b = row?.[k] ?? 0;
        if (a === b) continue;
        if (frozen("activity") && b >= a) notes.push(`economy ${d.day} ${k}: frozen Blob ${a}, Postgres ${b}`);
        else diffs.push(`economy ${d.day} ${k}: Blob ${a} vs Postgres ${b}`);
      }
    }
    out.push({ domain: "activity", checked, differences: cap(diffs), warnings: [], notes: cap(notes) });
  }

  if (domains.includes("pause")) {
    const diffs: string[] = [];
    const notes: string[] = [];
    const blob = await source.pause();
    const pg = await pgGetPauseState(db);
    for (const s of SUBSYSTEMS) {
      const a = blob.subsystems[s];
      const b = pg.subsystems[s];
      if (eq2(a ?? null, b ?? null)) continue;
      if (frozen("pause") && b && (b.since ?? 0) > (a?.since ?? 0)) notes.push(`${s}: changed in Postgres since the switch (frozen Blob: ${a?.paused ? "paused" : "running"}, Postgres: ${b.paused ? "paused" : "running"})`);
      else diffs.push(`${s}: Blob ${JSON.stringify(a ?? null)} vs Postgres ${JSON.stringify(b ?? null)}`);
    }
    out.push({ domain: "pause", checked: SUBSYSTEMS.length, differences: diffs, warnings: [], notes });
  }

  if (domains.includes("audit")) {
    const diffs: string[] = [];
    const blob = await source.audit();
    const ids = new Set(blob.map((e) => e.id));
    const pgIds = new Set<string>();
    const rows = await db.select({ id: auditEvents.eventId }).from(auditEvents);
    for (const r of rows) pgIds.add(r.id);
    for (const id of ids) if (!pgIds.has(id)) diffs.push(`audit event ${id} is in Blob but not in the Postgres chain`);
    // Events only in Postgres are expected in "postgres" mode; the chain itself must always verify.
    const verdict = await pgVerifyChain(db);
    if (!verdict.ok) diffs.push(`the hash chain is BROKEN at seq ${verdict.problem?.seq}: ${verdict.problem?.reason}`);
    out.push({ domain: "audit", checked: blob.length + verdict.checked, differences: cap(diffs), warnings: [], notes: [`Blob holds ${blob.length} event(s); the Postgres chain holds ${rows.length}${frozen("audit") ? ` (${rows.length - blob.length} recorded since the switch; a frozen Blob must not grow)` : ""}`] });
  }

  if (domains.includes("launch")) {
    const diffs: string[] = [];
    const blob = await source.feeLocks();
    const pg = await pgLoadPending(db);
    for (const m of new Set([...Object.keys(blob), ...Object.keys(pg)])) {
      if (!blob[m]) diffs.push(`fee-lock ${m}: only in Postgres`);
      else if (!pg[m]) diffs.push(`fee-lock ${m}: only in Blob`);
      else if (!eq2(blob[m], pg[m])) diffs.push(`fee-lock ${m}: Blob ${JSON.stringify(blob[m])} vs Postgres ${JSON.stringify(pg[m])}`);
    }
    out.push({ domain: "launch", checked: Object.keys(blob).length, differences: cap(diffs), warnings: [], notes: [] });
  }

  if (domains.includes("sessions")) {
    // Sessions and nonces are short-lived and not copied from Blob (a token is stateless there): there is nothing to compare, only to
    // confirm that dual mode is registering them in Postgres.
    const [{ n: live }] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions);
    const [{ n: nonces }] = await db.select({ n: sql<number>`count(*)::int` }).from(authNonces);
    out.push({ domain: "sessions", checked: Number(live) + Number(nonces), differences: [], warnings: [`Postgres holds ${live} session(s) and ${nonces} sign-in nonce(s) (informational)`], notes: [] });
  }

  return out;
}
