import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, doublePrecision, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * PANDA's Postgres schema (phase 6, point 1): the core that touches money or verified history. Everything else stays where it
 * is until its feature is switched on (docs/PHASE6_PLAN.md §1.1). Changes go through `npm run db:generate` (numbered SQL files
 * in /drizzle) and `npm run db:migrate`; nothing is ever edited by hand in the database.
 *
 * Money is in lamports as `bigint` (mode "number": every value is guarded to be a JS safe integer before it is written).
 * Rules the DATABASE enforces so a bug in the code can't break them: a holder's reserved + claimed rewards can never exceed
 * what was credited; a distribution is applied once per (transaction signature, mint); a trade or event is one row per id.
 */

const lamports = (name: string) => bigint(name, { mode: "number" });

// ── Rewards (money) ────────────────────────────────────────────────────────────────────────────────────────────────
/** Coins whose fee distribution the daily cron collects (was rewards/registry.json). */
export const rewardRegistry = pgTable("reward_registry", {
  mint: text("mint").primaryKey(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per coin: what was distributed to its holders' pool in total, and the rounding dust nobody was credited (was Ledger.total/dust). */
export const rewardLedgers = pgTable(
  "reward_ledgers",
  {
    mint: text("mint").primaryKey(),
    totalDistributedLamports: lamports("total_distributed_lamports").notNull().default(0),
    dustLamports: lamports("dust_lamports").notNull().default(0),
  },
  (t) => [check("reward_ledgers_nonneg", sql`${t.totalDistributedLamports} >= 0 AND ${t.dustLamports} >= 0`)]
);

/** One row per applied distribution: the idempotency anchor. A retry of the same cron transaction hits the primary key and changes nothing. */
export const rewardDistributions = pgTable(
  "reward_distributions",
  {
    sourceSig: text("source_sig").notNull(),
    mint: text("mint").notNull(),
    distributedLamports: lamports("distributed_lamports").notNull(),
    dustLamports: lamports("dust_lamports").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceSig, t.mint] }), check("reward_distributions_nonneg", sql`${t.distributedLamports} >= 0 AND ${t.dustLamports} >= 0`)]
);

/** Append-only: each holder's credit from one distribution. The balance is derived from these and kept in reward_balances. */
export const rewardCredits = pgTable(
  "reward_credits",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    mint: text("mint").notNull(),
    wallet: text("wallet").notNull(),
    lamports: lamports("lamports").notNull(),
    sourceSig: text("source_sig").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("reward_credits_once").on(t.sourceSig, t.mint, t.wallet), check("reward_credits_positive", sql`${t.lamports} > 0`), index("reward_credits_wallet").on(t.wallet)]
);

/** The lockable row per (coin, holder). credited = all credits; reserved = booked/sent, not yet confirmed; claimed = confirmed paid. */
export const rewardBalances = pgTable(
  "reward_balances",
  {
    mint: text("mint").notNull(),
    wallet: text("wallet").notNull(),
    creditedLamports: lamports("credited_lamports").notNull().default(0),
    reservedLamports: lamports("reserved_lamports").notNull().default(0),
    claimedLamports: lamports("claimed_lamports").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.mint, t.wallet] }),
    // The rule that makes overpaying impossible even if the code has a bug.
    check("reward_balances_no_overpay", sql`${t.reservedLamports} >= 0 AND ${t.claimedLamports} >= 0 AND ${t.reservedLamports} + ${t.claimedLamports} <= ${t.creditedLamports}`),
    index("reward_balances_wallet").on(t.wallet),
  ]
);

export const CLAIM_STATUSES = ["reserved", "sent", "confirmed", "failed", "released"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** State machine of a payout attempt: reserved → sent → confirmed, or → released/failed (reservation given back).
 *  `runId` ties a batch of these back to the cron pass that created them (holder_payout_runs below) — null for
 *  anything from before auto-payout existed (the old, now-removed manual "Reclamar" button never set it). */
export const rewardClaims = pgTable(
  "reward_claims",
  {
    id: uuid("id").primaryKey(),
    mint: text("mint").notNull(),
    wallet: text("wallet").notNull(),
    lamports: lamports("lamports").notNull(),
    status: text("status").notNull(),
    signature: text("signature"),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reward_claims_positive", sql`${t.lamports} > 0`),
    check("reward_claims_status", sql`${t.status} IN ('reserved','sent','confirmed','failed','released')`),
    index("reward_claims_holder").on(t.mint, t.wallet),
    index("reward_claims_open").on(t.status),
    index("reward_claims_run").on(t.runId),
  ]
);

/** What the pool paid out per UTC day, against the daily cap. */
export const payoutDays = pgTable("payout_days", { day: date("day", { mode: "string" }).primaryKey(), paidLamports: lamports("paid_lamports").notNull().default(0) }, (t) => [
  check("payout_days_nonneg", sql`${t.paidLamports} >= 0`),
]);

/** One row per cron pass that attempted to pay a coin's holders automatically (src/lib/rewards/payout.ts) — the
 *  "último reparto" a coin page and the admin view show. The real per-wallet facts live in reward_claims
 *  (joined by runId); this is a summary for display, never itself the source of truth for what was paid. */
export const holderPayoutRuns = pgTable(
  "holder_payout_runs",
  {
    id: uuid("id").primaryKey(),
    mint: text("mint").notNull(),
    status: text("status").notNull(), // 'done' | 'failed' — a run that is still mid-flight has no row yet (see payout.ts)
    holdersPaid: smallint("holders_paid").notNull().default(0),
    lamportsPaid: lamports("lamports_paid").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("holder_payout_runs_status", sql`${t.status} IN ('done','failed')`), check("holder_payout_runs_nonneg", sql`${t.holdersPaid} >= 0 AND ${t.lamportsPaid} >= 0`), index("holder_payout_runs_mint").on(t.mint, t.startedAt)]
);

// ── Trades ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One row per real trade of a wallet ((wallet, signature) is the key, so recording twice is a no-op, as in the per-wallet log it replaces). Floats are stored exactly as the app computed them. */
export const trades = pgTable(
  "trades",
  {
    signature: text("signature").notNull(),
    wallet: text("wallet").notNull(),
    mint: text("mint").notNull(),
    ticker: text("ticker").notNull(),
    side: text("side").notNull(),
    solAmount: doublePrecision("sol_amount").notNull(),
    tokenAmount: doublePrecision("token_amount").notNull(),
    solPriceUsdAtTrade: doublePrecision("sol_price_usd_at_trade").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    estimated: boolean("estimated").notNull().default(false),
    // Order of insertion: keeps a wallet's log in the same order the blob array had it.
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.signature] }), check("trades_side", sql`${t.side} IN ('buy','sell')`), index("trades_wallet_seq").on(t.wallet, t.seq)]
);

/** When a wallet's on-chain history was last scanned for trades made outside PANDA (was portfolio/backfill/<wallet>.json). */
export const backfillMarks = pgTable("backfill_marks", { wallet: text("wallet").primaryKey(), at: bigint("at", { mode: "number" }).notNull() });

// ── Activity journal and economy totals ─────────────────────────────────────────────────────────────────────────────
/** Events PANDA verified on-chain when they happened. The id is deterministic (trade:<sig>, claim:<sig>…) so the same event is one row. */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    mint: text("mint").notNull(),
    wallet: text("wallet"),
    lamports: lamports("lamports"),
    tokenAmount: doublePrecision("token_amount"),
    signature: text("signature"),
    verified: boolean("verified").notNull().default(false),
    /** UTC day this row was WRITTEN (the journal is windowed and capped by write day, as the daily blob documents were). */
    recordedDay: date("recorded_day", { mode: "string" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_events_day").on(t.recordedDay), index("activity_events_mint").on(t.mint)]
);

const metricColumns = {
  volumeLamports: lamports("volume_lamports").notNull().default(0),
  trades: lamports("trades").notNull().default(0),
  tradeFeeLamports: lamports("trade_fee_lamports").notNull().default(0),
  creatorFeeLamports: lamports("creator_fee_lamports").notNull().default(0),
  creatorFeeTreasuryLamports: lamports("creator_fee_treasury_lamports").notNull().default(0),
  creatorFeePoolLamports: lamports("creator_fee_pool_lamports").notNull().default(0),
  distributions: lamports("distributions").notNull().default(0),
  dropped: lamports("dropped").notNull().default(0),
};

/** Running totals PANDA measured, per UTC day of the event (was economy/daily/<day>.json). Only ever added to. */
export const economyDaily = pgTable("economy_daily", { day: date("day", { mode: "string" }).primaryKey(), ...metricColumns });

/** The all-time totals: a single row (id = 1) (was economy/total.json). */
export const economyTotal = pgTable(
  "economy_total",
  { id: smallint("id").primaryKey().default(1), since: bigint("since", { mode: "number" }), ...metricColumns },
  (t) => [check("economy_total_single", sql`${t.id} = 1`)]
);

// ── Protocol pause switches ─────────────────────────────────────────────────────────────────────────────────────────
export const protocolPause = pgTable("protocol_pause", {
  subsystem: text("subsystem").primaryKey(),
  paused: boolean("paused").notNull(),
  reason: text("reason").notNull(),
  since: bigint("since", { mode: "number" }).notNull(),
  byWallet: text("by_wallet").notNull(),
});


// ── Audit trail: an append-only hash chain (phase 6, point 3) ────────────────────────────────────────────────────────────
/**
 * Every event carries the hash of the one before it: hash = sha256(prev_hash ‖ canonical JSON of the event). Change, delete or
 * reorder any row and every later hash stops matching (src/lib/db/audit.ts verifies the chain). The database refuses UPDATE and
 * DELETE on this table (a trigger, migration 0001), so nothing edits history by accident. Someone who OWNS the database could still
 * rewrite the whole chain, which is why the head hash is periodically anchored in a Solana transaction (audit_anchors).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigint("seq", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: text("event_id").notNull().unique(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    object: text("object").notNull(),
    oldState: jsonb("old_state"),
    newState: jsonb("new_state"),
    reason: text("reason"),
    requestId: text("request_id").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_events_ts").on(t.ts), index("audit_events_action").on(t.action)]
);

/** The chain's head published on Solana (memo transaction signed by an admin): evidence that survives even a rewritten database. */
export const auditAnchors = pgTable("audit_anchors", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  headSeq: bigint("head_seq", { mode: "number" }).notNull(),
  headHash: text("head_hash").notNull(),
  signature: text("signature").notNull().unique(),
  wallet: text("wallet").notNull(),
  anchoredAt: timestamp("anchored_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Wallet sessions and sign-in nonces (phase 6, point 4) ───────────────────────────────────────────────────────────────
/** One row per issued session token (its `jti`). Revoking = setting revoked_at; a revoked or expired session is rejected at once. */
export const sessions = pgTable(
  "sessions",
  {
    jti: uuid("jti").primaryKey(),
    wallet: text("wallet").notNull(),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("sessions_wallet").on(t.wallet), index("sessions_expires").on(t.expiresAt)]
);

/** One-time sign-in challenges. Consuming one is a single conditional UPDATE, so of two simultaneous verifications exactly one wins. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    wallet: text("wallet").notNull(),
    issuedAt: bigint("issued_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
  },
  (t) => [index("auth_nonces_expires").on(t.expiresAt)]
);

// ── Launch: coins waiting for their fee split (two-transaction fallback) ────────────────────────────────────────────────
/** PANDA-launched coins whose fee split isn't on-chain yet; they stay out of every list until it is (src/lib/pump/fee-lock.ts). */
export const pendingFeeLocks = pgTable("pending_fee_locks", {
  mint: text("mint").primaryKey(),
  creator: text("creator").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  shareholders: jsonb("shareholders"),
  auditedAt: bigint("audited_at", { mode: "number" }),
});

// ── Two-tier trading fee ────────────────────────────────────────────────────────────────────────────────────────
/** Wallets that were already trading on PANDA before the two-tier fee shipped, grandfathered onto the lower
 *  rate (PANDA_REFERRED_FEE_BPS) forever, exactly as if they had a recruiter — see src/lib/pump/fee-tier.ts.
 *  Populated ONCE by scripts/backfill-legacy-fee-wallets.ts as a frozen snapshot: nothing ever adds to this
 *  table afterward, so a wallet's first trade AFTER that snapshot correctly pays the new default rate unless it
 *  has its own recruiter. */
export const legacyFeeWallets = pgTable("legacy_fee_wallets", {
  wallet: text("wallet").primaryKey(),
  markedAt: bigint("marked_at", { mode: "number" }).notNull(),
});

/** A recruiter's own short code (`launchonpanda.app/r/<code>`, and applicable by hand on the Recruiters page
 *  or at sign-in) — one per wallet, chosen once, permanent (so an already-shared link never breaks). Validated
 *  by src/lib/referrals/codes.ts before it ever reaches here; the DB only enforces uniqueness. */
export const recruiterCodes = pgTable("recruiter_codes", {
  code: text("code").primaryKey(),
  wallet: text("wallet").notNull().unique(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ── Recruiters (referrals) ──────────────────────────────────────────────────────────────────────────────────────
/** First-touch, permanent: the wallet credited with having brought `wallet` in. One row per referred wallet, ever
 *  (never overwritten — see src/lib/db/referrals.ts). The 3 "trader active" columns track a live, 3-UTC-day streak:
 *  see src/lib/referrals/streak.ts for exactly how they're read and written. `isActive` is deliberately NOT a
 *  stored column — it's computed from `lastQualifyingDay`/`streakAtLastQualifyingDay` at read time, so going
 *  inactive after 3 quiet days needs no cron sweep (this project's Vercel crons only run daily). `firstActivatedAt`
 *  is set exactly once, the first time the streak reaches 3, and never touched again — a reactivation after a gap
 *  reuses it, which is what gives a long-standing invitee their original place in the recruiter's marginal-tier
 *  ordering (src/lib/referrals/tiers.ts) instead of losing it to a quiet week. */
export const referrals = pgTable(
  "referrals",
  {
    wallet: text("wallet").primaryKey(), // the REFERRED wallet
    referrer: text("referrer").notNull(),
    boundAt: bigint("bound_at", { mode: "number" }).notNull(),
    lastQualifyingDay: date("last_qualifying_day", { mode: "string" }),
    streakAtLastQualifyingDay: smallint("streak_at_last_qualifying_day").notNull().default(0),
    firstActivatedAt: bigint("first_activated_at", { mode: "number" }),
    /** How the invitee arrived: a `?ref=` link ("link") or a recruiter's short code applied by hand ("code"). */
    source: text("source").notNull().default("link"),
    /** The short code that was applied when `source` is "code"; null for a link. */
    code: text("code"),
  },
  (t) => [
    check("referrals_no_self", sql`${t.wallet} <> ${t.referrer}`),
    check("referrals_streak_nonneg", sql`${t.streakAtLastQualifyingDay} >= 0`),
    check("referrals_source", sql`${t.source} in ('link', 'code')`),
    index("referrals_referrer").on(t.referrer),
    index("referrals_referrer_first_activated").on(t.referrer, t.firstActivatedAt),
  ]
);

/** A referral that has NOT become a binding yet, so the recruiter can still see it in their invitee list:
 *  "pending" = the anti-abuse check was inconclusive this time (retried automatically the next time that wallet
 *  connects and signs in, the code never has to be typed again); "rejected" = the check found the wallet was
 *  funded by the recruiter (shown only as "Rechazado", never with the reason). Deleted the moment the same wallet
 *  does bind through any path (see src/lib/db/referrals.ts's pgBindReferral). */
export const referralAttempts = pgTable(
  "referral_attempts",
  {
    wallet: text("wallet").primaryKey(), // the REFERRED wallet
    referrer: text("referrer").notNull(),
    source: text("source").notNull(),
    code: text("code"),
    status: text("status").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    check("referral_attempts_no_self", sql`${t.wallet} <> ${t.referrer}`),
    check("referral_attempts_source", sql`${t.source} in ('link', 'code')`),
    check("referral_attempts_status", sql`${t.status} in ('pending', 'rejected')`),
    index("referral_attempts_referrer").on(t.referrer),
  ]
);

/** Append-only: EVERY attempt to apply a code or bind through a link, whatever happened — unlike
 *  referral_attempts above (only the CURRENT pending/rejected state, one row per wallet, overwritten/deleted
 *  as things change), this never updates or deletes a row. The "Referidos" admin view (src/app/admin) searches
 *  this to answer "what actually happened for this code/wallet" — `reason` is the internal detail an admin
 *  sees, never the invitee (same anti-abuse-reason secrecy src/lib/referrals/anti-abuse.ts already keeps). */
export const referralAttemptLog = pgTable(
  "referral_attempt_log",
  {
    id: uuid("id").primaryKey(),
    wallet: text("wallet"), // null only if a code was typed before any wallet ever connected in that browser (never reaches this far today, kept nullable defensively)
    code: text("code"),
    referrer: text("referrer"),
    kind: text("kind").notNull(),
    result: text("result").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("referral_attempt_log_kind", sql`${t.kind} IN ('apply_code','sign_in')`),
    check("referral_attempt_log_result", sql`${t.result} IN ('bound','pending','rejected','already_bound','already_traded','invalid_code','error')`),
    index("referral_attempt_log_code").on(t.code),
    index("referral_attempt_log_wallet").on(t.wallet),
    index("referral_attempt_log_referrer").on(t.referrer),
    index("referral_attempt_log_created").on(t.createdAt),
  ]
);

/** One row per (referred wallet, UTC day) with any volume — only kept for wallets that have a referrer, so this
 *  never grows for the whole user base. Accumulated from src/app/api/portfolio/record-trade's own already-verified
 *  SOL-equivalent trade amount (never a separate, re-derived figure). Read by src/lib/referrals/streak.ts to decide
 *  whether a day crossed REFERRAL_MIN_DAILY_VOLUME_SOL and should extend or reset the streak above. */
export const referralDailyVolume = pgTable(
  "referral_daily_volume",
  {
    wallet: text("wallet").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    volumeLamports: lamports("volume_lamports").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.day] }), check("referral_daily_volume_nonneg", sql`${t.volumeLamports} >= 0`)]
);

/** One row per mint ever created through PANDA's own /create flow, written only after the creation transaction is
 *  confirmed on-chain (never from the client's say-so alone — same discipline as `trades`). Two things read this:
 *  the "Lanzadas en PANDA" showcase (src/components/home/HomeSection.tsx and friends), and a coin page's own
 *  landing-as-recruiter-link capture (src/lib/referrals/client.ts) — a PANDA-launched coin's `/coin/<mint>` page
 *  doubles as its creator's recruiter link. */
export const pandaLaunches = pgTable("panda_launches", {
  mint: text("mint").primaryKey(),
  creator: text("creator").notNull(),
  launchedAt: bigint("launched_at", { mode: "number" }).notNull(),
});

/** The 1,000 "Founder" slots: reserved the moment a recruiter reaches founderRequiredTraders() "valid" invitees
 *  (each with founderMinTraderVolumeUsd()+ of their own trade volume — see src/lib/referrals/founder.ts, called
 *  from src/app/api/portfolio/record-trade on every confirmed trade), long before the Founder NFT collection
 *  exists to mint into. A row existing here — reserved or minted, doesn't matter which — is what
 *  src/lib/referrals/tiers.ts's `isFounder()` checks for the permanent flat 30% share; `mintedAt`/`assetId` fill
 *  in once the collection is created and the reserved slots are minted (see scripts/nft-create-collection.ts). */
export const founderAllocations = pgTable(
  "founder_allocations",
  {
    wallet: text("wallet").primaryKey(),
    rank: smallint("rank").notNull(),
    reservedAt: bigint("reserved_at", { mode: "number" }).notNull(),
    mintedAt: bigint("minted_at", { mode: "number" }),
    assetId: text("asset_id"),
  },
  (t) => [unique("founder_allocations_rank").on(t.rank), check("founder_allocations_rank_range", sql`${t.rank} >= 1 AND ${t.rank} <= 1000`)]
);

/** Prepared, not wired to a live job yet (FEATURE_FOUNDER_PANDA_REWARDS is off, and there is no $PANDA mint to buy
 *  until the token launches) — see docs in src/lib/founder/panda-accrual.ts for what turns this on. Amounts are
 *  base units of $PANDA (like lamports are base units of SOL), not a float, so no token-decimals assumption is
 *  baked in before the token's real decimals are known. */
export const founderPandaAccrual = pgTable(
  "founder_panda_accrual",
  {
    wallet: text("wallet").primaryKey(),
    pendingBaseUnits: bigint("pending_base_units", { mode: "number" }).notNull().default(0),
    totalAccruedBaseUnits: bigint("total_accrued_base_units", { mode: "number" }).notNull().default(0),
    totalClaimedBaseUnits: bigint("total_claimed_base_units", { mode: "number" }).notNull().default(0),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    check(
      "founder_panda_accrual_nonneg",
      sql`${t.pendingBaseUnits} >= 0 AND ${t.totalAccruedBaseUnits} >= 0 AND ${t.totalClaimedBaseUnits} >= 0 AND ${t.totalClaimedBaseUnits} <= ${t.totalAccruedBaseUnits}`
    ),
  ]
);

/** One row per referral fee payment PANDA verified on-chain — informational only (a record for the Affiliates
 *  page's stats). PANDA never holds this money: it goes straight from the trader to the referrer inside the
 *  trade's own transaction, and this row is written only AFTER that transaction is confirmed. */
export const referralPayouts = pgTable(
  "referral_payouts",
  {
    signature: text("signature").notNull(),
    referrer: text("referrer").notNull(),
    referred: text("referred").notNull(),
    mint: text("mint").notNull(),
    lamports: lamports("lamports").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.signature, t.referrer] }), check("referral_payouts_positive", sql`${t.lamports} > 0`), index("referral_payouts_referrer").on(t.referrer)]
);

// ── Vanity mint keypairs (a pre-generated stock of "…panda" addresses) ────────────────────────────────────────────
/** One row per pre-generated mint keypair whose address ends in `suffix`, secret key encrypted at rest (see
 *  src/lib/vanity/crypto.ts). `claimedAt` set = already handed out to one coin launch — see src/lib/vanity/stock.ts. */
export const vanityMintKeys = pgTable(
  "vanity_mint_keys",
  {
    pubkey: text("pubkey").primaryKey(),
    suffix: text("suffix").notNull(),
    ciphertext: text("ciphertext").notNull(), // base64: AES-256-GCM(secretKey) || authTag
    nonce: text("nonce").notNull(), // base64, 12-byte GCM IV
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: bigint("claimed_at", { mode: "number" }),
  },
  (t) => [index("vanity_mint_keys_available").on(t.suffix, t.claimedAt)]
);

// ── Reserved mint keypairs (one-off addresses reserved for a specific creator+ticker — NOT the shared vanity stock above) ──
/** One row per reserved keypair, keyed by a human `purpose` (e.g. "panda_token"). Never drawn from by the
 *  generic vanity stock (src/lib/vanity/*) — only src/lib/reserved-mint/stock.ts reads these, and only for the
 *  exact wallet+ticker match it's configured for. `usedAt` set = already handed to a real creation; claimed
 *  exactly once, ever (see pgClaimReservedMintKey). Secret key encrypted at rest with its OWN key
 *  (RESERVED_MINT_KEY, src/lib/reserved-mint/crypto.ts) — deliberately separate from VANITY_STOCK_KEY so a
 *  leak of one never exposes the other. */
export const reservedMintKeys = pgTable("reserved_mint_keys", {
  purpose: text("purpose").primaryKey(),
  pubkey: text("pubkey").notNull().unique(),
  ciphertext: text("ciphertext").notNull(), // base64: AES-256-GCM(secretKey) || authTag
  nonce: text("nonce").notNull(), // base64, 12-byte GCM IV
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedAt: bigint("used_at", { mode: "number" }),
});

// ── PANDA orders (pre-signed sells / stops on a coin the wallet already holds — src/lib/panda-orders) ───────────────
/** The wallet's durable-nonce accounts (address derived from the wallet + seed; the wallet is their only authority).
 *  `pending` = handed out in a setup transaction not yet seen on-chain; `ready` = exists; `closed` = withdrawn by the
 *  user (deposit back). Whether one is in USE is derived from panda_orders (a live order references it). */
export const pandaNonceAccounts = pgTable(
  "panda_nonce_accounts",
  {
    address: text("address").primaryKey(),
    wallet: text("wallet").notNull(),
    seed: text("seed").notNull(),
    state: text("state").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("panda_nonce_accounts_wallet").on(t.wallet), check("panda_nonce_accounts_state", sql`${t.state} IN ('pending', 'ready', 'closed')`)]
);

/** One row per order leg (a sell or a stop). The signed transaction is stored ENCRYPTED (src/lib/panda-orders/crypto.ts)
 *  and wiped once the order is final. Rules the database enforces: amounts positive, the signed minimum never above the
 *  trigger, and at most ONE live sell and ONE live stop per nonce account (they are the two legs of one tranche). */
export const pandaOrders = pgTable(
  "panda_orders",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    mint: text("mint").notNull(),
    ticker: text("ticker").notNull(),
    groupId: text("group_id").notNull(),
    trancheId: text("tranche_id").notNull(),
    n: smallint("n").notNull(),
    leg: text("leg").notNull(),
    venue: text("venue").notNull(),
    pool: text("pool"),
    pct: doublePrecision("pct").notNull(),
    nonceAccount: text("nonce_account").notNull(),
    nonceValue: text("nonce_value").notNull(),
    tokenAmountRaw: text("token_amount_raw").notNull(),
    tokenDecimals: smallint("token_decimals").notNull(),
    triggerOutLamports: lamports("trigger_out_lamports").notNull(),
    minOutLamports: lamports("min_out_lamports").notNull(),
    feeLamports: lamports("fee_lamports").notNull(),
    targetUsd: doublePrecision("target_usd").notNull(),
    refUsd: doublePrecision("ref_usd").notNull(),
    state: text("state").notNull(),
    reason: text("reason"),
    messageHash: text("message_hash").notNull(),
    txCiphertext: text("tx_ciphertext"),
    txIv: text("tx_iv"),
    signature: text("signature"),
    notice: text("notice"),
    noticeAt: bigint("notice_at", { mode: "number" }),
    lastCheckedAt: bigint("last_checked_at", { mode: "number" }),
    unknownFailures: smallint("unknown_failures").notNull().default(0),
    sentAt: bigint("sent_at", { mode: "number" }),
    executedAt: bigint("executed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("panda_orders_wallet_mint").on(t.wallet, t.mint),
    index("panda_orders_state").on(t.state),
    index("panda_orders_group").on(t.groupId),
    uniqueIndex("panda_orders_live_leg").on(t.nonceAccount, t.leg).where(sql`${t.state} IN ('prepared', 'active', 'sending')`),
    check("panda_orders_state_check", sql`${t.state} IN ('prepared', 'active', 'sending', 'executed', 'cancelled', 'needs_resign')`),
    check("panda_orders_leg_check", sql`${t.leg} IN ('sell', 'stop')`),
    check("panda_orders_venue_check", sql`${t.venue} IN ('curve', 'amm')`),
    check("panda_orders_amounts", sql`${t.triggerOutLamports} > 0 AND ${t.minOutLamports} > 0 AND ${t.minOutLamports} <= ${t.triggerOutLamports} AND ${t.feeLamports} >= 0`),
    check("panda_orders_pct", sql`${t.pct} > 0 AND ${t.pct} <= 100`),
  ]
);

// ── Telegram bot (src/lib/telegram, docs/TELEGRAM.md) ────────────────────────────────────────────────────────────────
/** One row per Telegram user who talked to the bot. Only what the bot needs: the numeric id, the language to answer in, and — once
 *  they link it by signing with it — ONE wallet. A wallet can be linked to one Telegram account at a time (unique). `blocked`: the
 *  user blocked the bot (Telegram answered 403), so nothing more is queued for them. */
export const telegramUsers = pgTable(
  "telegram_users",
  {
    telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
    lang: text("lang").notNull().default("en"),
    wallet: text("wallet"),
    linkedAt: bigint("linked_at", { mode: "number" }),
    blocked: boolean("blocked").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("telegram_users_wallet").on(t.wallet).where(sql`${t.wallet} IS NOT NULL`), check("telegram_users_lang", sql`${t.lang} IN ('en', 'es')`)]
);

/** /link codes: only the SHA-256 of the code is stored. One use, 10 minutes, bound to the Telegram user who asked for it. */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
    usedByWallet: text("used_by_wallet"),
  },
  (t) => [index("telegram_link_codes_user").on(t.telegramId), index("telegram_link_codes_expires").on(t.expiresAt)]
);

export const telegramWatchlist = pgTable(
  "telegram_watchlist",
  {
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    mint: text("mint").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.telegramId, t.mint] })]
);

/** A personal price / market-cap alert. It fires ONCE (then `firedAt` is set and it stops being checked). */
export const telegramAlerts = pgTable(
  "telegram_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    mint: text("mint").notNull(),
    ticker: text("ticker").notNull(),
    metric: text("metric").notNull(),
    direction: text("direction").notNull(),
    value: doublePrecision("value").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    firedAt: bigint("fired_at", { mode: "number" }),
  },
  (t) => [
    index("telegram_alerts_user").on(t.telegramId),
    index("telegram_alerts_live").on(t.mint).where(sql`${t.firedAt} IS NULL`),
    check("telegram_alerts_metric", sql`${t.metric} IN ('price', 'mcap')`),
    check("telegram_alerts_direction", sql`${t.direction} IN ('above', 'below')`),
    check("telegram_alerts_value", sql`${t.value} > 0`),
  ]
);

/** Everything the bot sends goes through here: retried with backoff, paced to Telegram's limits, never blocking PANDA.
 *  `dedupeKey`: the same event (a launch, a buy's signature…) is queued once, however many times it is seen. */
export const telegramOutbox = pgTable(
  "telegram_outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dedupeKey: text("dedupe_key"),
    chatId: text("chat_id").notNull(),
    method: text("method").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    nextAttemptAt: bigint("next_attempt_at", { mode: "number" }).notNull(),
    lastError: text("last_error"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    sentAt: bigint("sent_at", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("telegram_outbox_dedupe").on(t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL`),
    index("telegram_outbox_due").on(t.status, t.nextAttemptAt),
    index("telegram_outbox_chat_sent").on(t.chatId, t.sentAt),
    check("telegram_outbox_status", sql`${t.status} IN ('pending', 'sent', 'failed')`),
    check("telegram_outbox_method", sql`${t.method} IN ('sendMessage', 'sendPhoto')`),
  ]
);

/** Telegram re-delivers an update it thinks wasn't answered: each update_id is handled once. Old rows are cleaned up. */
export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  receivedAt: bigint("received_at", { mode: "number" }).notNull(),
});

/** Small cursors for the automatic posts (last launch seen, last $PANDA buy seen…). */
export const telegramState = pgTable("telegram_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** /suggest: the text, who sent it (Telegram id) and when. Shown in /admin. */
export const telegramSuggestions = pgTable(
  "telegram_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    text: text("text").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("telegram_suggestions_created").on(t.createdAt), check("telegram_suggestions_len", sql`char_length(${t.text}) BETWEEN 1 AND 1000`)]
);

/** Public changelog drafts (src/lib/telegram/changelog.ts): what was proposed, and what an admin decided — once. */
export const telegramChangelogs = pgTable(
  "telegram_changelogs",
  {
    id: text("id").primaryKey(),
    /** What is being approved: "changelog" (the channel) today; other kinds (posts for X) use the same approval flow. */
    kind: text("kind").notNull().default("changelog"),
    /** Version 1 while pending; once published, exactly what was published. */
    text: text("text").notNull(),
    /** Every version on offer: [{ en, es | null, mine? }]. `es` is the translation shown to the admins — never published. */
    versions: jsonb("versions").$type<{ en: string; es: string | null; mine?: boolean }[]>().notNull().default([]),
    publishedVersion: smallint("published_version"),
    /**
     * What a draft carries besides its versions: its level ("important" | "small"), its one-line summary for the weekly
     * post, the draft it was sent with (`pair`), whether it IS a weekly summary, and — for a post on X — the image and
     * link choices and, once published, the post's id. Never a credential.
     */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** pending → published | discarded | deferred (kept for the weekly summary) → digested (it went into one).
     *  A post on X passes through "publishing" (claimed, being sent) and may end "failed" (outcome unknown: never sent again). */
    status: text("status").notNull().default("pending"),
    decidedBy: bigint("decided_by", { mode: "number" }),
    decidedAt: bigint("decided_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("telegram_changelogs_created").on(t.createdAt),
    check("telegram_changelogs_status", sql`${t.status} IN ('pending', 'published', 'discarded', 'deferred', 'digested', 'publishing', 'failed')`),
    check("telegram_changelogs_len", sql`char_length(${t.text}) BETWEEN 1 AND 3500`),
  ]
);

export const schema = {
  pendingFeeLocks, sessions, authNonces, auditEvents, auditAnchors,
  rewardRegistry, rewardLedgers, rewardDistributions, rewardCredits, rewardBalances, rewardClaims, payoutDays, holderPayoutRuns,
  trades, backfillMarks, activityEvents, economyDaily, economyTotal, protocolPause,
  referrals, referralAttemptLog, referralPayouts, referralDailyVolume, pandaLaunches, founderAllocations, founderPandaAccrual, vanityMintKeys,
  legacyFeeWallets, recruiterCodes, reservedMintKeys, pandaNonceAccounts, pandaOrders,
  telegramUsers, telegramLinkCodes, telegramWatchlist, telegramAlerts, telegramOutbox, telegramUpdates, telegramState, telegramSuggestions, telegramChangelogs,
};
