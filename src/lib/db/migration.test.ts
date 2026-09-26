import { test, before } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { setDbForTests } from "./client";
import { newTestDb } from "./testing";
import { blobSource } from "./source";
import { backfill } from "./backfill";
import { compare } from "./compare";
import { DOMAINS } from "./mode";
import { creditHolders, reserveClaim, confirmClaim } from "@/lib/rewards/ledger";
import { registerMint } from "@/lib/rewards/registry";
import { reserveDailyPayout } from "@/lib/rewards/limits";
import { recordTrade, addEstimatedTrades, setBackfillMark } from "@/lib/portfolio/trade-log";
import { recordActivity } from "@/lib/activity/record";
import { setPause } from "@/lib/protocol/pause-store";
import { pgOpenClaims, pgReserveClaim } from "./rewards";
import { rewardBalances, rewardClaims, trades } from "./schema";
import { pgAddTrades, pgGetTrades } from "./trades";

/**
 * The migration end to end, on real code paths: data is written to (in-memory) Blob through the real stores in "blob" mode — the way
 * production has been running — then backfilled into Postgres and compared.
 */

let db: Db;
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
  delete process.env.PANDA_STORAGE_MODES; // blob mode: how the data got there

  const MINT = "M".repeat(43), MINT2 = "N".repeat(43);
  const A = "A".repeat(43), B = "B".repeat(43), C = "C".repeat(43);
  await registerMint(MINT);
  await registerMint(MINT2);
  await creditHolders(MINT, 1_000_003, [{ address: A, lamports: 600_000 }, { address: B, lamports: 400_000 }], 3, "dist1");
  await creditHolders(MINT, 500_000, [{ address: A, lamports: 250_000 }, { address: C, lamports: 250_000 }], 0, "dist2");
  await creditHolders(MINT2, 10, [{ address: A, lamports: 10 }], 0, "dist3");
  const r = await reserveClaim(MINT, A, 300_000);
  await confirmClaim(r);
  await reserveDailyPayout(300_000);

  const trade = (i: number, extra = {}) => ({ mint: MINT, ticker: "TT", side: (i % 2 ? "sell" : "buy") as "buy" | "sell", solAmount: 0.25 + i / 3, tokenAmount: 1000.5 * (i + 1), solPriceUsdAtTrade: 150.123456, signature: `sig${i}`, ts: 1_750_000_000_000 + i, ...extra });
  await recordTrade(A, trade(0));
  await recordTrade(A, trade(1));
  await addEstimatedTrades(A, [trade(2, { estimated: true })]);
  await recordTrade(B, trade(7));
  await setBackfillMark(A, 1_750_000_999_000);

  const ev = (id: string, kind: "buy" | "reward_claim", extra = {}) => ({ id, kind, ts: Date.now() - 5000, mint: MINT, ...extra });
  await recordActivity(ev("claim:one111", "reward_claim", { wallet: A, lamports: 300_000, signature: "s".repeat(88) }), { distributions: 1, creatorFeePoolLamports: 300_000 });
  await recordActivity(ev("trade:two222", "buy", { wallet: B, lamports: 50_000_000 }), { volumeLamports: 50_000_000, trades: 1, tradeFeeLamports: 500_000 });

  await setPause("claims", true, "migration rehearsal", "ADMIN");
});

test("BACKFILL then COMPARE: Postgres ends up identical to Blob in every domain, and the report says how much moved", async () => {
  const src = blobSource();
  const reports = await backfill(db, src, [...DOMAINS]);
  const byDomain = Object.fromEntries(reports.map((r) => [r.domain, r]));
  assert.deepEqual(reports.flatMap((r) => r.problems), []);
  assert.equal(byDomain.rewards.imported.registry, 2);
  assert.equal(byDomain.rewards.imported.holders, 4, "3 holders on the first coin + 1 on the second");
  assert.equal(byDomain.trades.imported.trades, 4);
  assert.equal(byDomain.activity.imported.events, 2);
  assert.equal(byDomain.pause.imported.subsystems, 1);
  const result = await compare(db, src, [...DOMAINS]);
  for (const r of result) assert.deepEqual(r.differences, [], `${r.domain} differs`);
  assert.ok(result.find((r) => r.domain === "rewards")!.checked >= 3);
});

test("backfill is re-runnable: a second run changes nothing and still compares equal", async () => {
  const src = blobSource();
  await backfill(db, src, [...DOMAINS]);
  const [bal] = await db.select().from(rewardBalances).where(eq(rewardBalances.wallet, "A".repeat(43)));
  assert.ok(bal);
  const rows = await db.select().from(trades);
  assert.equal(rows.length, 4, "no duplicated trades");
  for (const r of await compare(db, src, [...DOMAINS])) assert.deepEqual(r.differences, [], r.domain);
});

test("the imported ledger keeps the money invariants: credits add up to balances, and entitled + dust = distributed", async () => {
  const src = blobSource();
  await backfill(db, src, ["rewards"]);
  const r = (await compare(db, src, ["rewards"]))[0];
  assert.deepEqual(r.differences, []);
  const [{ total }] = await db.select({ total: sql<number>`sum(${rewardBalances.creditedLamports})::bigint` }).from(rewardBalances).where(eq(rewardBalances.mint, "M".repeat(43)));
  assert.equal(Number(total), 1_500_000);
});

test("a trade log keeps the exact order and float values after the migration", async () => {
  const src = blobSource();
  await backfill(db, src, ["trades"]);
  const fromPg = await pgGetTrades(db, "A".repeat(43));
  assert.deepEqual(fromPg, await src.trades("A".repeat(43)));
  assert.deepEqual(fromPg.map((t) => t.signature), ["sig0", "sig1", "sig2"]);
});

test("COMPARE reports a real difference — a lamport off in one balance, a missing trade, a missing event, a wrong pause — and where", async () => {
  const src = blobSource();
  await backfill(db, src, [...DOMAINS]);
  await db.update(rewardBalances).set({ claimedLamports: 299_999 }).where(and(eq(rewardBalances.wallet, "A".repeat(43)), eq(rewardBalances.mint, "M".repeat(43))));
  await db.delete(trades).where(eq(trades.signature, "sig1"));
  await db.execute(sql`delete from activity_events where id = 'trade:two222'`);
  await db.execute(sql`update protocol_pause set paused = false`);
  const result = Object.fromEntries((await compare(db, src, [...DOMAINS])).map((r) => [r.domain, r]));
  assert.ok(result.rewards.differences.some((d) => /claimed/.test(d)), "rewards: " + result.rewards.differences.join("|"));
  assert.ok(result.trades.differences.some((d) => /Blob has 3 trades, Postgres 2/.test(d)));
  assert.ok(result.activity.differences.some((d) => /trade:two222/.test(d)));
  assert.ok(result.pause.differences.some((d) => /claims/.test(d)));
  await backfill(db, src, [...DOMAINS]); // and re-running the backfill heals all of it
  for (const r of await compare(db, src, [...DOMAINS])) assert.deepEqual(r.differences, [], r.domain);
});

test("a Blob ledger that already breaks its own invariant is NOT imported (and is reported), never silently 'fixed'", async () => {
  const bad = { ...blobSource(), registry: async () => ["BADMINT" + "x".repeat(36)], ledger: async (mint: string) => ({ mint, totalDistributedLamports: 100, holders: { H: { entitledLamports: 60, claimedLamports: 70 } } }) };
  const [report] = await backfill(db, bad, ["rewards"]);
  assert.ok(report.problems.length >= 2, report.problems.join("|"));
  assert.ok(report.problems.some((p) => /claimed 70 exceeds entitled 60/.test(p)));
  assert.equal((await db.select().from(rewardBalances).where(eq(rewardBalances.mint, "BADMINT" + "x".repeat(36)))).length, 0);
});

test("COMPARE warns about a payout that was sent and has no recorded outcome (money that may or may not have left)", async () => {
  const src = blobSource();
  await backfill(db, src, ["rewards"]);
  const r = await pgReserveClaim(db, "N".repeat(43), "A".repeat(43), 10);
  assert.equal(r.amount, 10);
  await db.update(rewardClaims).set({ status: "sent", signature: "UNKNOWN" }).where(eq(rewardClaims.id, r.id));
  assert.equal((await pgOpenClaims(db)).length >= 1, true);
  const rewards = (await compare(db, src, ["rewards"]))[0];
  assert.ok(rewards.warnings.some((w) => /no recorded outcome/.test(w) && /UNKNOWN/.test(w)));
});

test("FROZEN BLOB (a domain in postgres mode): Postgres being ahead is a note, but anything only in Blob — or a write that reached Blob after the switch — is still a difference", async () => {
  const src = blobSource();
  await backfill(db, src, [...DOMAINS]);
  const modes = { trades: "postgres", pause: "postgres", audit: "postgres" } as const;
  for (const r of await compare(db, src, ["trades", "pause"], modes)) assert.deepEqual(r.differences, [], r.domain);

  // After the switch: a new trade and a pause change land ONLY in Postgres.
  const A = "A".repeat(43);
  await pgAddTrades(db, A, [{ mint: "M".repeat(43), ticker: "TT", side: "buy", solAmount: 0.02, tokenAmount: 192_216.9, solPriceUsdAtTrade: 100, signature: "AFTERSWITCH", ts: 1_750_000_100_000 }]);
  await db.execute(sql`update protocol_pause set since = since + 5000, paused = not paused where subsystem = 'claims'`);
  const ahead = await compare(db, src, ["trades", "pause"], modes);
  for (const r of ahead) assert.deepEqual(r.differences, [], `${r.domain}: Postgres ahead of a frozen Blob is expected`);
  assert.ok(ahead.find((r) => r.domain === "trades")!.notes.some((n) => /recorded since the switch/.test(n)));
  assert.ok(ahead.find((r) => r.domain === "pause")!.notes.some((n) => /claims/.test(n)));
  // ...while the same state read as "dual" is a difference (there a lost Blob write matters).
  assert.ok((await compare(db, src, ["trades"], {}))[0].differences.length > 0);

  // A trade that reaches Blob after the switch (a write path that ignored the mode) is a difference in a frozen domain.
  await recordTrade("Z".repeat(43), { mint: "M".repeat(43), ticker: "TT", side: "buy", solAmount: 0.1, tokenAmount: 5, solPriceUsdAtTrade: 100, signature: "LEAKED", ts: 1_750_000_200_000 });
  const leaked = (await compare(db, src, ["trades"], modes))[0];
  assert.ok(leaked.differences.some((d) => /only in Blob|Blob has 1 trades, Postgres 0/.test(d)), leaked.differences.join("|"));
});
