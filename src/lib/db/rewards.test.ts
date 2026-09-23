import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { newTestDb } from "./testing";
import {
  pgConfirmClaim,
  pgCreditHolders,
  pgGetLedger,
  pgGetPayoutDay,
  pgGetRegisteredMints,
  pgMarkClaimSent,
  pgOpenClaims,
  pgRegisterMint,
  pgReleaseClaim,
  pgReleaseDailyPayout,
  pgReserveClaim,
  pgReserveDailyPayout,
  pgReserveExact,
} from "./rewards";
import { rewardBalances, rewardClaims, rewardCredits } from "./schema";

let db: Db;
before(async () => {
  db = await newTestDb();
});

let n = 0;
const fresh = () => ({ mint: `MINT${++n}`.padEnd(40, "x"), holder: `HOLDER${n}`.padEnd(40, "y"), sig: `SIG${n}` });
const credit = (mint: string, sourceSig: string, credits: { address: string; lamports: number }[], dust = 0) =>
  pgCreditHolders(db, { mint, sourceSig, distributedLamports: credits.reduce((s, c) => s + c.lamports, dust), credits, dustLamports: dust });

test("registry: registering twice keeps one row", async () => {
  const { mint } = fresh();
  await pgRegisterMint(db, mint);
  await pgRegisterMint(db, mint);
  assert.equal((await pgGetRegisteredMints(db)).filter((m) => m === mint).length, 1);
});

test("a distribution is booked exactly once per (signature, mint): the same cron transaction twice changes nothing", async () => {
  const { mint, holder, sig } = fresh();
  assert.equal(await credit(mint, sig, [{ address: holder, lamports: 1000 }], 7), "applied");
  assert.equal(await credit(mint, sig, [{ address: holder, lamports: 1000 }], 7), "duplicate");
  const ledger = await pgGetLedger(db, mint);
  assert.equal(ledger.totalDistributedLamports, 1007);
  assert.equal(ledger.dustLamports, 7);
  assert.deepEqual(ledger.holders[holder], { entitledLamports: 1000, claimedLamports: 0 });
});

test("distributions accumulate across signatures, and one wallet listed twice is one credit", async () => {
  const { mint, holder } = fresh();
  await credit(mint, "A-" + mint, [{ address: holder, lamports: 400 }, { address: holder, lamports: 100 }]);
  await credit(mint, "B-" + mint, [{ address: holder, lamports: 50 }], 3);
  const ledger = await pgGetLedger(db, mint);
  assert.equal(ledger.totalDistributedLamports, 553);
  assert.equal(ledger.holders[holder].entitledLamports, 550);
  assert.equal(ledger.dustLamports, 3);
});

test("FAIL CLOSED: credits + dust that don't add up to the distributed amount write nothing", async () => {
  const { mint, holder, sig } = fresh();
  await assert.rejects(pgCreditHolders(db, { mint, sourceSig: sig, distributedLamports: 1000, credits: [{ address: holder, lamports: 900 }], dustLamports: 50 }), /don't add up/);
  await assert.rejects(pgCreditHolders(db, { mint, sourceSig: sig, distributedLamports: 100, credits: [{ address: holder, lamports: -5 }], dustLamports: 105 }), /don't add up/);
  await assert.rejects(pgCreditHolders(db, { mint, sourceSig: sig, distributedLamports: 2 ** 60, credits: [{ address: holder, lamports: 2 ** 60 }], dustLamports: 0 }), /don't add up/);
  const ledger = await pgGetLedger(db, mint);
  assert.equal(ledger.totalDistributedLamports, 0);
  assert.deepEqual(ledger.holders, {});
});

test("ATOMIC: if a later step fails, the distribution row, totals and earlier credits are all rolled back", async () => {
  const { mint, holder, sig } = fresh();
  // A pre-existing credit row with the same (sig, mint, wallet) makes the credits insert fail AFTER the distribution row and totals were written.
  await db.insert(rewardCredits).values({ mint, wallet: holder, lamports: 1, sourceSig: sig });
  await assert.rejects(credit(mint, sig, [{ address: holder, lamports: 500 }]));
  const ledger = await pgGetLedger(db, mint);
  assert.equal(ledger.totalDistributedLamports, 0, "totals rolled back");
  assert.equal(await credit(mint, sig + "-retry", [{ address: holder, lamports: 500 }]), "applied", "and the same coin can be distributed to afterwards");
});

test("reserving takes min(available, max) and a second reservation only sees what is left", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1000 }]);
  const a = await pgReserveClaim(db, mint, holder, 600);
  assert.equal(a.amount, 600);
  const b = await pgReserveClaim(db, mint, holder, 600);
  assert.equal(b.amount, 400);
  const c = await pgReserveClaim(db, mint, holder, 600);
  assert.equal(c.amount, 0);
  assert.equal((await pgGetLedger(db, mint)).holders[holder].claimedLamports, 1000, "reserved counts as claimed, like the Blob ledger");
});

test("nothing to reserve for an unknown holder, and no claim row is written", async () => {
  const { mint, holder } = fresh();
  assert.equal((await pgReserveClaim(db, mint, holder, 500)).amount, 0);
  assert.equal((await db.select().from(rewardClaims).where(sql`${rewardClaims.mint} = ${mint}`)).length, 0);
});

test("CONCURRENCY: 25 simultaneous claims for the same balance pay out exactly the balance, never more", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1_000_000 }]);
  const results = await Promise.all(Array.from({ length: 25 }, () => pgReserveClaim(db, mint, holder, 1_000_000)));
  const total = results.reduce((s, r) => s + r.amount, 0);
  assert.equal(total, 1_000_000);
  assert.equal(results.filter((r) => r.amount > 0).length, 1, "one winner takes the whole balance");
  const [bal] = await db.select().from(rewardBalances).where(sql`${rewardBalances.mint} = ${mint}`);
  assert.equal(bal.reservedLamports, 1_000_000);
});

test("CONCURRENCY: many small claims (max 100k each) add up to the balance and no more", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1_000_000 }]);
  const results = await Promise.all(Array.from({ length: 30 }, () => pgReserveClaim(db, mint, holder, 100_000)));
  assert.equal(results.reduce((s, r) => s + r.amount, 0), 1_000_000);
  assert.equal(results.filter((r) => r.amount > 0).length, 10);
});

/** Drizzle wraps the driver error ("Failed query…"); the constraint name is on its cause. */
const violates = (constraint: RegExp) => (err: unknown) => {
  const text = `${(err as Error).message} ${((err as { cause?: Error }).cause?.message ?? "")}`;
  assert.match(text, constraint);
  return true;
};

test("THE DATABASE REFUSES TO OVERPAY: a direct write that would make reserved + claimed exceed credited is rejected", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 100 }]);
  await assert.rejects(db.update(rewardBalances).set({ reservedLamports: 101 }).where(sql`${rewardBalances.mint} = ${mint}`), violates(/no_overpay/i));
  await assert.rejects(db.update(rewardBalances).set({ claimedLamports: 60, reservedLamports: 41 }).where(sql`${rewardBalances.mint} = ${mint}`), violates(/no_overpay/i));
  await assert.rejects(db.update(rewardBalances).set({ reservedLamports: -1 }).where(sql`${rewardBalances.mint} = ${mint}`), violates(/no_overpay/i));
});

test("claim lifecycle: reserved → sent → confirmed moves the amount from reserved to claimed", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1000 }]);
  const r = await pgReserveClaim(db, mint, holder, 400);
  assert.equal(await pgMarkClaimSent(db, r.id, "SENTSIG" + n), true);
  assert.equal(await pgConfirmClaim(db, r.id), true);
  const [bal] = await db.select().from(rewardBalances).where(sql`${rewardBalances.mint} = ${mint}`);
  assert.deepEqual([bal.creditedLamports, bal.reservedLamports, bal.claimedLamports], [1000, 0, 400]);
  assert.equal(await pgConfirmClaim(db, r.id), false, "confirming twice is a no-op");
  assert.equal(await pgReleaseClaim(db, r.id), false, "a paid claim can never be released (that would let it be paid again)");
  assert.equal((await pgGetLedger(db, mint)).holders[holder].claimedLamports, 400);
});

test("releasing a claim that did not land gives the amount back, once", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1000 }]);
  const r = await pgReserveClaim(db, mint, holder, 1000);
  assert.equal(await pgReleaseClaim(db, r.id), true);
  assert.equal(await pgReleaseClaim(db, r.id), false, "releasing twice must not give the amount back twice");
  assert.equal((await pgGetLedger(db, mint)).holders[holder].claimedLamports, 0);
  assert.equal((await pgReserveClaim(db, mint, holder, 1000)).amount, 1000, "and it can be claimed again");
});

test("a sent claim with no outcome stays reserved (can't be paid twice) and shows up as open for review", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 1000 }]);
  const r = await pgReserveClaim(db, mint, holder, 1000);
  await pgMarkClaimSent(db, r.id, "UNKNOWNSIG" + n);
  assert.equal((await pgReserveClaim(db, mint, holder, 1000)).amount, 0);
  const open = await pgOpenClaims(db);
  assert.ok(open.some((c) => c.id === r.id && c.status === "sent" && c.signature === "UNKNOWNSIG" + n));
});

test("the dual-write mirror reserves exactly what Blob decided, or refuses and leaves nothing half-applied", async () => {
  const { mint, holder, sig } = fresh();
  await credit(mint, sig, [{ address: holder, lamports: 500 }]);
  const ok = await pgReserveExact(db, mint, holder, 300);
  assert.equal(ok.amount, 300);
  await assert.rejects(pgReserveExact(db, mint, holder, 300), /only 200 of the 300/);
  assert.equal((await pgGetLedger(db, mint)).holders[holder].claimedLamports, 300, "the failed mirror left no partial reservation");
});

test("CONCURRENCY: the daily cap holds under simultaneous bookings", async () => {
  const day = "2031-01-15";
  const results = await Promise.all(Array.from({ length: 40 }, () => pgReserveDailyPayout(db, day, 10, 100)));
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(await pgGetPayoutDay(db, day), 100);
  assert.equal(await pgReserveDailyPayout(db, day, 1, 100), false);
  await pgReleaseDailyPayout(db, day, 30);
  assert.equal(await pgGetPayoutDay(db, day), 70);
  await pgReleaseDailyPayout(db, day, 1_000);
  assert.equal(await pgGetPayoutDay(db, day), 0, "never below zero");
});
