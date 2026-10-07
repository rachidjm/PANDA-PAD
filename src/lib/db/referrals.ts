import { and, count, eq, gte, inArray, isNull, lt, ne, or, sql, sum } from "drizzle-orm";
import type { Db } from "./client";
import { founderAllocations, pandaLaunches, referralAttempts, referralDailyVolume, referralPayouts, referrals, trades } from "./schema";

/** This wallet's referrer, or null if it was never bound (came in without a link, failed anti-abuse, ...). */
export async function pgGetReferrer(db: Db, wallet: string): Promise<string | null> {
  const [row] = await db.select({ referrer: referrals.referrer }).from(referrals).where(eq(referrals.wallet, wallet));
  return row?.referrer ?? null;
}

/** `wallet`'s own cumulative USD volume (buys + sells, each at its own historical SOL/USD price) — what
 *  src/lib/pump/fee-tier.ts checks against referredDiscountMinVolumeUsd() to turn on an invited wallet's
 *  lifetime 0.5% (it starts at the default 1% the moment it's bound, same as an un-referred wallet, until it
 *  crosses that threshold). Same live-aggregate shape as pgInviteeVolumesUsd/pgCountValidInvitees, just for one wallet. */
export async function pgOwnVolumeUsd(db: Db, wallet: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${trades.solAmount} * ${trades.solPriceUsdAtTrade}), 0)` })
    .from(trades)
    .where(eq(trades.wallet, wallet));
  return Number(row?.total ?? 0);
}

/**
 * First-touch, permanent: binds `wallet` to `referrer` UNLESS it's already bound to someone (itself included) —
 * a primary-key conflict, so of two concurrent sign-ins only one ever wins. Returns whether THIS call bound it.
 * Callers must reject `wallet === referrer` themselves before calling (the CHECK constraint is the last line of
 * defense, not the primary one — it turns a bug here into a loud failure instead of a silent bad row).
 */
export type BindOrigin = { source: "link" | "code"; code?: string | null };

/** Same first-touch, conflict-safe insert as ever, plus: a binding that lands also clears any pending/rejected
 *  attempt for that wallet (one transaction, so the invitee list never shows both a binding and an attempt). */
export async function pgBindReferral(db: Db, wallet: string, referrer: string, boundAt: number, origin: BindOrigin = { source: "link" }): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(referrals)
      .values({ wallet, referrer, boundAt, source: origin.source, code: origin.source === "code" ? (origin.code ?? null) : null })
      .onConflictDoNothing()
      .returning({ wallet: referrals.wallet });
    if (rows.length === 0) return false;
    await tx.delete(referralAttempts).where(eq(referralAttempts.wallet, wallet));
    return true;
  });
}

/** This wallet's binding in full (who, through what, when, its own streak state) — null if it isn't bound. */
export async function pgGetReferralBinding(
  db: Db,
  wallet: string
): Promise<{ referrer: string; source: "link" | "code"; code: string | null; boundAt: number; lastQualifyingDay: string | null; streakAtLastQualifyingDay: number } | null> {
  const [row] = await db
    .select({
      referrer: referrals.referrer,
      source: referrals.source,
      code: referrals.code,
      boundAt: referrals.boundAt,
      lastQualifyingDay: referrals.lastQualifyingDay,
      streakAtLastQualifyingDay: referrals.streakAtLastQualifyingDay,
    })
    .from(referrals)
    .where(eq(referrals.wallet, wallet));
  return row ? { ...row, source: row.source as "link" | "code" } : null;
}

/** Records (or refreshes) an attempt that is not a binding yet — see the `referralAttempts` table in schema.ts.
 *  Latest attempt wins: an attempt is never a binding, so overwriting it can't change who a wallet belongs to. */
export async function pgUpsertReferralAttempt(
  db: Db,
  row: { wallet: string; referrer: string; source: "link" | "code"; code: string | null; status: "pending" | "rejected"; updatedAt: number }
): Promise<void> {
  await db
    .insert(referralAttempts)
    .values(row)
    .onConflictDoUpdate({ target: referralAttempts.wallet, set: { referrer: row.referrer, source: row.source, code: row.code, status: row.status, updatedAt: row.updatedAt } });
}

export async function pgGetReferralAttempt(db: Db, wallet: string): Promise<{ referrer: string; status: "pending" | "rejected" } | null> {
  const [row] = await db.select({ referrer: referralAttempts.referrer, status: referralAttempts.status }).from(referralAttempts).where(eq(referralAttempts.wallet, wallet));
  return row ? { referrer: row.referrer, status: row.status as "pending" | "rejected" } : null;
}

/** Records one verified on-chain referral payment (informational — see schema.ts). Returns false if it was already recorded. */
export async function pgRecordReferralPayout(
  db: Db,
  row: { signature: string; referrer: string; referred: string; mint: string; lamports: number; ts: number }
): Promise<boolean> {
  const rows = await db.insert(referralPayouts).values(row).onConflictDoNothing().returning({ signature: referralPayouts.signature });
  return rows.length > 0;
}

export type ReferralStats = { referredCount: number; earnedLamports: number };

/** How many wallets `referrer` has brought in, and how much PANDA has verified was actually paid to them on-chain. */
export async function pgReferralStats(db: Db, referrer: string): Promise<ReferralStats> {
  const [[{ n }], [{ total }]] = await Promise.all([
    db.select({ n: count() }).from(referrals).where(eq(referrals.referrer, referrer)),
    db.select({ total: sum(referralPayouts.lamports) }).from(referralPayouts).where(eq(referralPayouts.referrer, referrer)),
  ]);
  return { referredCount: n, earnedLamports: Number(total ?? 0) };
}

// ── Trader-active streak (src/lib/referrals/streak.ts is the orchestrator; these are the raw reads/writes) ─────────

export type StreakState = { lastQualifyingDay: string | null; streakAtLastQualifyingDay: number; firstActivatedAt: number | null };

export async function pgGetReferralStreak(db: Db, wallet: string): Promise<StreakState | null> {
  const [row] = await db
    .select({ lastQualifyingDay: referrals.lastQualifyingDay, streakAtLastQualifyingDay: referrals.streakAtLastQualifyingDay, firstActivatedAt: referrals.firstActivatedAt })
    .from(referrals)
    .where(eq(referrals.wallet, wallet));
  return row ?? null;
}

export async function pgSetReferralStreak(db: Db, wallet: string, state: StreakState): Promise<void> {
  await db.update(referrals).set(state).where(eq(referrals.wallet, wallet));
}

/** Adds `addLamports` to `wallet`'s volume for UTC day `day` (inserted at 0 first if today has no row yet) and
 *  returns the new running total for that day, so the caller can tell whether THIS trade is what crossed the
 *  daily-qualifying threshold. Only ever called for a wallet that has a referrer — see streak.ts. */
export async function pgAddDailyVolume(db: Db, wallet: string, day: string, addLamports: number): Promise<number> {
  const [row] = await db
    .insert(referralDailyVolume)
    .values({ wallet, day, volumeLamports: addLamports })
    .onConflictDoUpdate({ target: [referralDailyVolume.wallet, referralDailyVolume.day], set: { volumeLamports: sql`${referralDailyVolume.volumeLamports} + ${addLamports}` } })
    .returning({ volumeLamports: referralDailyVolume.volumeLamports });
  return row.volumeLamports;
}

export type InviteeRow = {
  wallet: string;
  boundAt: number;
  lastQualifyingDay: string | null;
  streakAtLastQualifyingDay: number;
  firstActivatedAt: number | null;
  source: "link" | "code";
  code: string | null;
};

/** Every invitee `referrer` has ever bound, newest first — the raw rows the Recruiters page turns into a live
 *  active/inactive/"n of 3 days" status (src/lib/referrals/tiers.ts's `isCurrentlyActive`, applied per row). */
export async function pgListInvitees(db: Db, referrer: string): Promise<InviteeRow[]> {
  return db
    .select({
      wallet: referrals.wallet,
      boundAt: referrals.boundAt,
      lastQualifyingDay: referrals.lastQualifyingDay,
      streakAtLastQualifyingDay: referrals.streakAtLastQualifyingDay,
      firstActivatedAt: referrals.firstActivatedAt,
      source: referrals.source,
      code: referrals.code,
    })
    .from(referrals)
    .where(eq(referrals.referrer, referrer))
    .orderBy(sql`${referrals.boundAt} desc`) as Promise<InviteeRow[]>;
}

/** Every pending/rejected attempt `referrer` has (see referralAttempts in schema.ts) — listed next to the bindings. */
export async function pgListReferralAttempts(db: Db, referrer: string): Promise<{ wallet: string; status: "pending" | "rejected"; source: "link" | "code"; code: string | null; updatedAt: number }[]> {
  const rows = await db
    .select({ wallet: referralAttempts.wallet, status: referralAttempts.status, source: referralAttempts.source, code: referralAttempts.code, updatedAt: referralAttempts.updatedAt })
    .from(referralAttempts)
    .where(eq(referralAttempts.referrer, referrer))
    .orderBy(sql`${referralAttempts.updatedAt} desc`);
  return rows.map((r) => ({ ...r, status: r.status as "pending" | "rejected", source: r.source as "link" | "code" }));
}

/** How much PANDA has verified was paid to `referrer`, broken down by WHICH invitee's trades earned it. */
export async function pgInviteeEarnings(db: Db, referrer: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ referred: referralPayouts.referred, total: sum(referralPayouts.lamports) })
    .from(referralPayouts)
    .where(eq(referralPayouts.referrer, referrer))
    .groupBy(referralPayouts.referred);
  return Object.fromEntries(rows.map((r) => [r.referred, Number(r.total ?? 0)]));
}

// ── Marginal tiers (live-computed rank — see src/lib/referrals/tiers.ts for the full reasoning) ────────────────────

/** Exists (reserved or minted, either counts) = Founder: a flat share, no rank computation needed. */
export async function pgIsFounder(db: Db, wallet: string): Promise<boolean> {
  const [row] = await db.select({ wallet: founderAllocations.wallet }).from(founderAllocations).where(eq(founderAllocations.wallet, wallet));
  return !!row;
}

/**
 * `invitee`'s live rank among `referrer`'s invitees: 1 + how many of the OTHER invitees are active right now
 * (`cutoffDay` is the earliest `lastQualifyingDay` that still counts as active — today minus 2 UTC days, computed
 * by the caller so this function stays pure/testable) and first activated earlier than `invitee` did — or, if
 * `invitee` has never activated, than ALL of `referrer`'s currently-active invitees (they'd join at the back of
 * the queue). See src/lib/referrals/tiers.ts for why this has to be a live count, not a stored number.
 */
export async function pgLiveRankOfInvitee(db: Db, referrer: string, invitee: string, cutoffDay: string): Promise<number> {
  const invStreak = await pgGetReferralStreak(db, invitee);
  const invFirstActivatedAt = invStreak?.firstActivatedAt ?? null;
  const activeNow = and(eq(referrals.referrer, referrer), ne(referrals.wallet, invitee), sql`${referrals.streakAtLastQualifyingDay} >= 3`, gte(referrals.lastQualifyingDay, cutoffDay));
  const arrivedBefore = invFirstActivatedAt === null ? sql`true` : or(lt(referrals.firstActivatedAt, invFirstActivatedAt), isNull(referrals.firstActivatedAt));
  const [{ n }] = await db.select({ n: count() }).from(referrals).where(and(activeNow, arrivedBefore));
  return n + 1;
}

/** How many of `referrer`'s invitees are active right now — used only to detect crossing the 500/1,500 alert thresholds. */
export async function pgCountLiveActive(db: Db, referrer: string, cutoffDay: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(referrals)
    .where(and(eq(referrals.referrer, referrer), sql`${referrals.streakAtLastQualifyingDay} >= 3`, gte(referrals.lastQualifyingDay, cutoffDay)));
  return n;
}

// ── Founder slots ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Reserves the next Founder slot for `wallet` unless all 1,000 are already taken or it already has one — same
 *  hard-cap-under-advisory-lock shape as pgRegisterPending (src/lib/db/launch.ts), so concurrent first-invitee
 *  binds can never both reserve the same rank or push past 1,000. Returns the reserved rank, or null if none left
 *  or `wallet` already had one. */
export async function pgReserveFounderSlot(db: Db, wallet: string, reservedAt: number, maxSlots = 1000): Promise<number | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('panda_founder_allocations'))`);
    const [existing] = await tx.select({ rank: founderAllocations.rank }).from(founderAllocations).where(eq(founderAllocations.wallet, wallet));
    if (existing) return null;
    const [{ n }] = await tx.select({ n: count() }).from(founderAllocations);
    if (n >= maxSlots) return null;
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${founderAllocations.rank}), 0)::int + 1` }).from(founderAllocations);
    await tx.insert(founderAllocations).values({ wallet, rank: next, reservedAt });
    return next;
  });
}

export async function pgFounderSlotsTaken(db: Db): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(founderAllocations);
  return n;
}

export async function pgFounderAllocation(db: Db, wallet: string): Promise<{ rank: number; reservedAt: number; mintedAt: number | null; assetId: string | null } | null> {
  const [row] = await db.select().from(founderAllocations).where(eq(founderAllocations.wallet, wallet));
  return row ?? null;
}

/** Founder slots still waiting for a real mint (collection not created yet, or created after they reserved). */
export async function pgUnmintedFounderAllocations(db: Db): Promise<{ wallet: string; rank: number }[]> {
  return db.select({ wallet: founderAllocations.wallet, rank: founderAllocations.rank }).from(founderAllocations).where(isNull(founderAllocations.mintedAt));
}

export async function pgMarkFounderMinted(db: Db, wallet: string, mintedAt: number, assetId: string): Promise<void> {
  await db.update(founderAllocations).set({ mintedAt, assetId }).where(eq(founderAllocations.wallet, wallet));
}

/** Releases (deletes) `wallet`'s Founder slot — used only by the one-time migration off the old "first invitee"
 *  rule (scripts/migrate-founder-slots-to-new-rule.ts). Leaves a gap in `rank` rather than re-packing the
 *  numbering: a live site must never have an existing Founder's rank change under them. Returns whether a row
 *  was actually deleted. */
export async function pgReleaseFounderSlot(db: Db, wallet: string): Promise<boolean> {
  const rows = await db.delete(founderAllocations).where(eq(founderAllocations.wallet, wallet)).returning({ wallet: founderAllocations.wallet });
  return rows.length > 0;
}

/** Every Founder allocation that exists right now — used only by the migration script above (ordinary request
 *  code reads one wallet at a time via pgFounderAllocation/pgIsFounder). */
export async function pgAllFounderAllocations(db: Db): Promise<{ wallet: string; rank: number; mintedAt: number | null }[]> {
  return db.select({ wallet: founderAllocations.wallet, rank: founderAllocations.rank, mintedAt: founderAllocations.mintedAt }).from(founderAllocations);
}

/**
 * How many of `referrer`'s invitees are "valid" toward their Founder-slot progress — anti-abuse is already
 * guaranteed for every bound invitee by construction (tryBindReferral never binds anything but a "clean"
 * verdict, see src/lib/referrals/bind.ts), so the only remaining condition is the invitee's own cumulative
 * trade volume. A correlated subquery rather than a join + group-by: there's no need to compute every
 * invitee's volume when only the COUNT crossing the threshold matters.
 */
export async function pgCountValidInvitees(db: Db, referrer: string, minUsd: number): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrer, referrer),
        sql`(select coalesce(sum(${trades.solAmount} * ${trades.solPriceUsdAtTrade}), 0) from ${trades} where ${trades.wallet} = ${referrals.wallet}) >= ${minUsd}`
      )
    );
  return n;
}

/** Every one of `referrer`'s invitees' own cumulative USD volume, keyed by wallet — invitees with zero trades
 *  are simply absent from the result (the caller treats a missing key as 0). One query for the whole Recruiters
 *  page, not one query per invitee. */
export async function pgInviteeVolumesUsd(db: Db, referrer: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ wallet: trades.wallet, total: sql<number>`coalesce(sum(${trades.solAmount} * ${trades.solPriceUsdAtTrade}), 0)` })
    .from(trades)
    .innerJoin(referrals, eq(referrals.wallet, trades.wallet))
    .where(eq(referrals.referrer, referrer))
    .groupBy(trades.wallet);
  return Object.fromEntries(rows.map((r) => [r.wallet, Number(r.total)]));
}

// ── Coins launched through PANDA's own /create flow ──────────────────────────────────────────────────────────────

/** Written once, only after the creation transaction is confirmed on-chain (never from the client's say-so alone). */
export async function pgRecordPandaLaunch(db: Db, mint: string, creator: string, launchedAt: number): Promise<boolean> {
  const rows = await db.insert(pandaLaunches).values({ mint, creator, launchedAt }).onConflictDoNothing().returning({ mint: pandaLaunches.mint });
  return rows.length > 0;
}

export async function pgGetPandaLaunch(db: Db, mint: string): Promise<{ creator: string; launchedAt: number } | null> {
  const [row] = await db.select({ creator: pandaLaunches.creator, launchedAt: pandaLaunches.launchedAt }).from(pandaLaunches).where(eq(pandaLaunches.mint, mint));
  return row ?? null;
}

/** Which of `mints` were launched through PANDA, keyed by mint — one query for a whole coin list (see
 *  src/lib/live-coins.ts), never one query per coin. Empty input short-circuits (no query) — a list refresh with
 *  no coins is already an edge case the callers handle themselves. */
export async function pgGetPandaLaunchesForMints(db: Db, mints: string[]): Promise<Map<string, { creator: string; launchedAt: number }>> {
  if (mints.length === 0) return new Map();
  const rows = await db.select({ mint: pandaLaunches.mint, creator: pandaLaunches.creator, launchedAt: pandaLaunches.launchedAt }).from(pandaLaunches).where(inArray(pandaLaunches.mint, mints));
  return new Map(rows.map((r) => [r.mint, { creator: r.creator, launchedAt: r.launchedAt }]));
}
