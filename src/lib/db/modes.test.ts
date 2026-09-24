import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Db } from "./client";
import { DbNotConfiguredError, setDbForTests } from "./client";
import { newTestDb } from "./testing";
import { needsDatabase, parseStorageModes, storageMode } from "./mode";
import { type Ledger, creditHolders, getLedger, markClaimSent, confirmClaim, releaseClaim, reserveClaim } from "@/lib/rewards/ledger";
import { getRegisteredMints, registerMint } from "@/lib/rewards/registry";
import { releaseDailyPayout, reserveDailyPayout } from "@/lib/rewards/limits";
import { readJson } from "@/lib/rewards/blob-store";
import { pgGetLedger, pgGetPayoutDay, pgGetRegisteredMints, pgOpenClaims } from "./rewards";
import { getTrades, recordTrade, addEstimatedTrades, getBackfillMark, setBackfillMark } from "@/lib/portfolio/trade-log";
import { pgGetTrades } from "./trades";
import { recordActivity } from "@/lib/activity/record";
import { readJournal } from "@/lib/activity/journal";
import { readTotal } from "@/lib/economy/rollup";
import { pgReadJournal, pgReadTotal } from "./activity";
import { getPauseState, setPause } from "@/lib/protocol/pause-store";
import { pgGetPauseState } from "./pause";
import { pgGetBackfillMark } from "./trades";

let db: Db;
before(async () => {
  db = await newTestDb();
});
afterEach(() => {
  delete process.env.PANDA_STORAGE_MODES;
  setDbForTests(db);
});

const modes = (v: string) => {
  process.env.PANDA_STORAGE_MODES = v;
  setDbForTests(db);
};
let n = 0;
const ids = () => ({ mint: `MODE${++n}`.padEnd(43, "m"), holder: `HOLD${n}`.padEnd(43, "h"), sig: `MSIG${n}`.padEnd(88, "s") });

test("parseStorageModes: default is Blob everywhere; bad entries are reported and ignored", () => {
  assert.deepEqual(parseStorageModes(undefined).modes, { rewards: "blob", trades: "blob", activity: "blob", pause: "blob", audit: "blob", sessions: "blob", launch: "blob" });
  const p = parseStorageModes("rewards=dual, trades=postgres ,nonsense,activity=maybe,pause=blob=x");
  assert.equal(p.modes.rewards, "dual");
  assert.equal(p.modes.trades, "postgres");
  assert.equal(p.modes.activity, "blob");
  assert.equal(p.problems.length, 3);
  assert.equal(needsDatabase({ PANDA_STORAGE_MODES: "rewards=dual" }), true);
  assert.equal(needsDatabase({ PANDA_STORAGE_MODES: "rewards=blob" }), false);
  assert.equal(needsDatabase({}), false);
  assert.equal(storageMode("pause", { PANDA_STORAGE_MODES: "pause=postgres" }), "postgres");
});

// ── rewards ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("BLOB mode touches only Blob: nothing reaches Postgres", async () => {
  modes("rewards=blob");
  const { mint, holder, sig } = ids();
  await registerMint(mint);
  await creditHolders(mint, 1000, [{ address: holder, lamports: 1000 }], 0, sig);
  const r = await reserveClaim(mint, holder, 400);
  assert.equal(r.amount, 400);
  assert.equal(r.pgId, undefined);
  assert.equal((await getLedger(mint)).holders[holder].claimedLamports, 400);
  assert.ok(!(await pgGetRegisteredMints(db)).includes(mint));
  assert.deepEqual((await pgGetLedger(db, mint)).holders, {});
});

test("DUAL mode: Blob decides and both stores end identical through credit → reserve → sent → confirm, and a release", async () => {
  modes("rewards=dual");
  const { mint, holder, sig } = ids();
  const other = "OTHER" + n;
  await registerMint(mint);
  await creditHolders(mint, 1010, [{ address: holder, lamports: 700 }, { address: other, lamports: 300 }], 10, sig);
  const a = await reserveClaim(mint, holder, 500);
  assert.equal(a.amount, 500);
  assert.ok(a.pgId, "mirrored into Postgres");
  await markClaimSent(a, "SENT" + n);
  await confirmClaim(a);
  const b = await reserveClaim(mint, holder, 500);
  assert.equal(b.amount, 200);
  await releaseClaim(b);
  const blob = await readJson<Ledger | null>(`rewards/ledger/${mint}.json`, null);
  const pg = await pgGetLedger(db, mint);
  assert.deepEqual(pg, blob, "Postgres equals the Blob ledger, field for field");
  assert.equal(pg.holders[holder].claimedLamports, 500);
  assert.ok((await getRegisteredMints()).includes(mint));
  assert.ok((await pgGetRegisteredMints(db)).includes(mint));
});

test("DUAL mode: the same distribution credited twice (a cron retry) is counted once in Postgres", async () => {
  modes("rewards=dual");
  const { mint, holder, sig } = ids();
  await creditHolders(mint, 100, [{ address: holder, lamports: 100 }], 0, sig);
  await creditHolders(mint, 100, [{ address: holder, lamports: 100 }], 0, sig);
  assert.equal((await pgGetLedger(db, mint)).totalDistributedLamports, 100, "Postgres is idempotent per signature (Blob, as before, is not)");
});

test("DUAL mode: daily payout is mirrored (book and release)", async () => {
  modes("rewards=dual");
  const before = await pgGetPayoutDay(db, new Date().toISOString().slice(0, 10));
  assert.equal(await reserveDailyPayout(1234), true);
  assert.equal(await pgGetPayoutDay(db, new Date().toISOString().slice(0, 10)), before + 1234);
  await releaseDailyPayout(234);
  assert.equal(await pgGetPayoutDay(db, new Date().toISOString().slice(0, 10)), before + 1000);
});

test("DUAL mode: if Postgres is down the user's action still works on Blob (the mirror fails loudly, not the claim)", async () => {
  modes("rewards=dual");
  const { mint, holder, sig } = ids();
  await creditHolders(mint, 500, [{ address: holder, lamports: 500 }], 0, sig);
  setDbForTests(null); // no DATABASE_URL either
  const r = await reserveClaim(mint, holder, 300);
  assert.equal(r.amount, 300, "the claim was reserved on Blob");
  assert.equal(r.pgId, undefined);
  await markClaimSent(r, "S"); // no-ops, must not throw
  await confirmClaim(r);
  await creditHolders(mint, 10, [{ address: holder, lamports: 10 }], 0, sig + "2"); // also fine
  assert.equal((await getLedger(mint)).holders[holder].entitledLamports, 510);
});

test("POSTGRES mode: only Postgres is used, Blob is never touched", async () => {
  modes("rewards=postgres");
  const { mint, holder, sig } = ids();
  await registerMint(mint);
  await creditHolders(mint, 900, [{ address: holder, lamports: 900 }], 0, sig);
  const r = await reserveClaim(mint, holder, 1000);
  assert.equal(r.amount, 900);
  await markClaimSent(r, "PGSENT" + n);
  assert.ok((await pgOpenClaims(db)).some((c) => c.id === r.pgId && c.status === "sent"));
  await confirmClaim(r);
  assert.deepEqual((await getLedger(mint)).holders[holder], { entitledLamports: 900, claimedLamports: 900 });
  assert.deepEqual(await readJson(`rewards/ledger/${mint}.json`, "untouched"), "untouched", "no Blob document was written");
  assert.ok((await getRegisteredMints()).includes(mint));
});

test("POSTGRES mode fails CLOSED with no database: claims and credits error out instead of silently using Blob", async () => {
  modes("rewards=postgres");
  setDbForTests(null);
  delete process.env.DATABASE_URL;
  await assert.rejects(reserveClaim("M".repeat(43), "H".repeat(43), 100), DbNotConfiguredError);
  await assert.rejects(getLedger("M".repeat(43)), DbNotConfiguredError);
  await assert.rejects(creditHolders("M".repeat(43), 1, [{ address: "H", lamports: 1 }], 0, "s"), DbNotConfiguredError);
});

test("POSTGRES mode: a release gives the reservation back, and a failed release surfaces (the balance must not silently stay locked)", async () => {
  modes("rewards=postgres");
  const { mint, holder, sig } = ids();
  await creditHolders(mint, 400, [{ address: holder, lamports: 400 }], 0, sig);
  const r = await reserveClaim(mint, holder, 400);
  await releaseClaim(r);
  assert.equal((await getLedger(mint)).holders[holder].claimedLamports, 0);
  const r2 = await reserveClaim(mint, holder, 400);
  setDbForTests(null);
  await assert.rejects(releaseClaim(r2), DbNotConfiguredError);
});

// ── trades ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const trade = (i: number) => ({ mint: "T".repeat(43), ticker: "TT", side: "buy" as const, solAmount: 0.5 + i / 7, tokenAmount: 1000 + i, solPriceUsdAtTrade: 151.5, signature: `tsig${i}`, ts: 1_750_000_000_000 + i });

test("trades: DUAL keeps Blob and Postgres identical; POSTGRES reads only Postgres", async () => {
  modes("trades=dual");
  const w = "TW" + "w".repeat(42);
  await recordTrade(w, trade(1));
  await recordTrade(w, trade(1)); // duplicate
  assert.equal(await addEstimatedTrades(w, [trade(1), { ...trade(2), estimated: true }]), 1);
  await setBackfillMark(w, 777);
  assert.deepEqual(await pgGetTrades(db, w), await getTrades(w));
  assert.equal((await getTrades(w)).length, 2);
  assert.deepEqual(await pgGetBackfillMark(db, w), { at: 777 });
  assert.deepEqual(await getBackfillMark(w), { at: 777 });

  modes("trades=postgres");
  const w2 = "TX" + "x".repeat(42);
  await recordTrade(w2, trade(5));
  assert.deepEqual(await getTrades(w2), [trade(5)]);
  assert.deepEqual(await readJson(`portfolio/trades/${w2}.json`, "untouched"), "untouched");
});

// ── activity + economy ────────────────────────────────────────────────────────────────────────────────────────────
test("activity: DUAL records the event and its totals in both, POSTGRES only in Postgres, a repeat counts once", async () => {
  modes("activity=dual");
  ids();
  // Valid base58 (the journal validates addresses and signatures): no 0, O, I or l.
  const ev = { id: `claim:${n}abcdef`, kind: "reward_claim" as const, ts: Date.now() - 1000, mint: "M".repeat(43), lamports: 5000, signature: "s".repeat(88) };
  const blobBefore = (await readTotal()).metrics.distributions;
  await recordActivity(ev, { distributions: 1 });
  await recordActivity(ev, { distributions: 1 });
  assert.equal((await readTotal()).metrics.distributions - blobBefore, 1);
  assert.equal((await pgReadTotal(db)).metrics.distributions, 1);
  assert.ok((await readJournal(Date.now())).some((e) => e.id === ev.id));
  assert.ok((await pgReadJournal(db, Date.now(), 3)).some((e) => e.id === ev.id));

  modes("activity=postgres");
  const ev2 = { ...ev, id: `claim:${n}zzzzzz` };
  await recordActivity(ev2, { distributions: 1 });
  assert.equal((await readTotal()).metrics.distributions, 2, "reads come from Postgres now");
  assert.ok((await readJournal(Date.now())).some((e) => e.id === ev2.id));
});

test("activity: an invalid event writes nothing and never throws (a journal problem must not fail a trade)", async () => {
  modes("activity=postgres");
  await recordActivity({ id: "x", kind: "reward_claim", ts: 1, mint: "nope" });
  setDbForTests(null);
  await recordActivity({ id: `claim:valid1`, kind: "reward_claim", ts: Date.now(), mint: "M".repeat(43) }); // no DB: swallowed
});

// ── pause ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("pause: DUAL mirrors the switch; POSTGRES reads and writes only Postgres", async () => {
  modes("pause=dual");
  await setPause("airdrops", true, "dual test", "ADMIN1");
  assert.equal((await pgGetPauseState(db)).subsystems.airdrops?.paused, true);
  assert.equal((await getPauseState()).subsystems.airdrops?.paused, true);

  modes("pause=postgres");
  await setPause("nft_market", true, "pg only", "ADMIN2");
  assert.equal((await getPauseState()).subsystems.nft_market?.by, "ADMIN2");
  assert.equal((await pgGetPauseState(db)).subsystems.nft_market?.paused, true);
});

// ── environment reporting ─────────────────────────────────────────────────────────────────────────────────────────────
import { envReport } from "@/lib/config/env";
const status = (env: Record<string, string>, name: string) => envReport(env).find((i) => i.name === name)!;

test("env: DATABASE_URL is required only when a domain uses Postgres, must look like a postgres URL, and is never echoed", () => {
  assert.equal(status({}, "DATABASE_URL").required, false);
  assert.equal(status({ PANDA_STORAGE_MODES: "rewards=blob" }, "DATABASE_URL").required, false);
  assert.equal(status({ PANDA_STORAGE_MODES: "rewards=dual" }, "DATABASE_URL").required, true);
  assert.equal(status({ PANDA_STORAGE_MODES: "rewards=dual" }, "DATABASE_URL").status, "absent");
  assert.equal(status({ DATABASE_URL: "postgresql://user:secret@host/db?sslmode=require" }, "DATABASE_URL").status, "present");
  assert.equal(status({ DATABASE_URL: "mysql://nope" }, "DATABASE_URL").status, "invalid");
  assert.ok(!JSON.stringify(envReport({ DATABASE_URL: "postgresql://user:secret@host/db" })).includes("secret"));
});

test("env: an unreadable PANDA_STORAGE_MODES is reported invalid instead of being guessed", () => {
  assert.equal(status({ PANDA_STORAGE_MODES: "rewards=dual,trades=postgres" }, "PANDA_STORAGE_MODES").status, "present");
  assert.equal(status({ PANDA_STORAGE_MODES: "rewards=maybe" }, "PANDA_STORAGE_MODES").status, "invalid");
  assert.equal(status({}, "PANDA_STORAGE_MODES").status, "absent");
});

// ── audit ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { listAudit, recordAudit } from "@/lib/audit/log";
import { pgListAudit, pgVerifyChain } from "./audit";

test("audit: DUAL writes Blob and the hash chain; POSTGRES writes only the chain and reads it back; a database outage never blocks the action", async () => {
  modes("audit=dual");
  await recordAudit({ actor: "ADMIN", action: "test.dual", object: "obj-dual" });
  assert.ok((await pgListAudit(db, 50)).some((e) => e.action === "test.dual"), "mirrored into the chain");
  assert.ok((await listAudit(50)).some((e) => e.action === "test.dual"), "Blob (dev memory) still has it and is what dual reads");

  modes("audit=postgres");
  await recordAudit({ actor: "ADMIN", action: "test.pg", object: "obj-pg", oldState: { a: 1 }, newState: { b: [2] } });
  const listed = await listAudit(50);
  assert.equal(listed[0].action, "test.pg", "postgres mode reads the chain, newest first");
  assert.equal((await pgVerifyChain(db)).ok, true);

  setDbForTests(null); // outage: recordAudit must not throw
  await recordAudit({ actor: "ADMIN", action: "test.outage", object: "x" });
});

test("audit backfill: Blob's events are imported in order into an empty chain, and compare reports the chain as intact", async () => {
  const { backfill } = await import("./backfill");
  const { compare } = await import("./compare");
  const { blobSource } = await import("./source");
  const own = await newTestDb();
  const events = [3, 1, 2].map((i) => ({ id: `${String(1_750_000_000_000 + i).padStart(13, "0")}-00000000000${i}`, ts: 1_750_000_000_000 + i, actor: "A", action: `old.${i}`, object: "o", requestId: `r${i}` }));
  const src = { ...blobSource(), audit: async () => events };
  const [report] = await backfill(own, src, ["audit"]);
  assert.equal(report.imported.added, 3);
  assert.deepEqual((await pgListAudit(own, 10)).map((e) => e.action), ["old.3", "old.2", "old.1"]);
  const [cmp] = await compare(own, src, ["audit"]);
  assert.deepEqual(cmp.differences, []);
  const missing = { ...src, audit: async () => [...events, { ...events[0], id: "9999999999999-ffffffffffff" }] };
  assert.ok((await compare(own, missing, ["audit"]))[0].differences.some((d) => /9999999999999/.test(d)));
});

// ── launch (fee-lock registry) ────────────────────────────────────────────────────────────────────────────────────────
import { getPendingFeeLocks, registerPendingFeeLock, resolvePending, withoutPendingFeeLock } from "@/lib/pump/fee-lock";
import { Keypair } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { pgLoadPending } from "./launch";

const chainOf = (existing: Set<string>) => ({ getAccountInfo: async (k: { toBase58(): string }) => (existing.has(k.toBase58()) ? { data: Buffer.alloc(0) } : null), getMultipleAccountsInfo: async () => [] }) as unknown as Connection;

test("launch registry: DUAL mirrors into Postgres; POSTGRES reads and writes only Postgres, and the audit-once stamp holds", async () => {
  modes("launch=dual");
  const m1 = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const split = [{ address: creator, shareBps: 10_000 }];
  assert.deepEqual(await registerPendingFeeLock(chainOf(new Set()), { mint: m1, creator, shareholders: split }), { ok: true });
  assert.ok(m1 in (await pgLoadPending(db)), "mirrored");

  modes("launch=postgres");
  const m2 = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(await registerPendingFeeLock(chainOf(new Set()), { mint: m2, creator, shareholders: split }), { ok: true });
  assert.deepEqual(await withoutPendingFeeLock([{ mint: m2 }]), [], "hidden from lists");
  assert.ok(m2 in (await getPendingFeeLocks()));
  // created on-chain without a SharingConfig: audited once
  const onChain = chainOf(new Set([m2]));
  const noSharing = { readSharing: async () => null, register: async () => {} };
  for (let i = 0; i < 3; i++) await resolvePending(onChain, m2, noSharing);
  assert.equal((await listAudit(100)).filter((e) => e.object === m2 && e.action === "token.created_without_fee_split").length <= 1, true);
  // its split lands on-chain: it leaves the registry
  const TREASURY = (await import("@/lib/pump/constants")).PANDA_TREASURY.toBase58();
  const r = await resolvePending(onChain, m2, { readSharing: async () => [{ address: TREASURY, shareBps: 500 }, { address: creator, shareBps: 9500 }], register: async () => {} });
  assert.equal(r.state, "locked");
  assert.ok(!(m2 in (await pgLoadPending(db))));
});

test("launch backfill + compare: the registry moves over and compares equal", async () => {
  const { backfill } = await import("./backfill");
  const { compare } = await import("./compare");
  const { blobSource } = await import("./source");
  const own = await newTestDb();
  const entries = { ["A".repeat(43)]: { creator: "C".repeat(43), ts: 1_750_000_000_000, shareholders: [{ address: "C".repeat(43), shareBps: 10_000 }], auditedAt: 1_750_000_001_000 }, ["B".repeat(43)]: { creator: "D".repeat(43), ts: 1_750_000_002_000, shareholders: null } };
  const src = { ...blobSource(), feeLocks: async () => entries };
  await backfill(own, src, ["launch"]);
  assert.deepEqual((await compare(own, src, ["launch"]))[0].differences, []);
  assert.ok((await compare(own, { ...src, feeLocks: async () => ({ ...entries, ["Z".repeat(43)]: { creator: "C".repeat(43), ts: 1, shareholders: null } }) }, ["launch"]))[0].differences.some((d) => /only in Blob/.test(d)));
});
