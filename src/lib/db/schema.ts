import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, doublePrecision, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

/** State machine of a payout attempt: reserved → sent → confirmed, or → released/failed (reservation given back). */
export const rewardClaims = pgTable(
  "reward_claims",
  {
    id: uuid("id").primaryKey(),
    mint: text("mint").notNull(),
    wallet: text("wallet").notNull(),
    lamports: lamports("lamports").notNull(),
    status: text("status").notNull(),
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("reward_claims_positive", sql`${t.lamports} > 0`),
    check("reward_claims_status", sql`${t.status} IN ('reserved','sent','confirmed','failed','released')`),
    index("reward_claims_holder").on(t.mint, t.wallet),
    index("reward_claims_open").on(t.status),
  ]
);

/** What the pool paid out per UTC day, against the daily cap. */
export const payoutDays = pgTable("payout_days", { day: date("day", { mode: "string" }).primaryKey(), paidLamports: lamports("paid_lamports").notNull().default(0) }, (t) => [
  check("payout_days_nonneg", sql`${t.paidLamports} >= 0`),
]);

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

export const schema = {
  pendingFeeLocks, sessions, authNonces, auditEvents, auditAnchors,
  rewardRegistry, rewardLedgers, rewardDistributions, rewardCredits, rewardBalances, rewardClaims, payoutDays,
  trades, backfillMarks, activityEvents, economyDaily, economyTotal, protocolPause,
};
