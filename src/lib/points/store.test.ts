import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { awardPoints, createEpoch, finalizeEpoch, getEpochs, getTotals, getWalletDoc, transitionEpoch } from "./store";
import { walletTotal } from "./events";
import { docRead } from "@/lib/storage/store";
import { EpochTotals, totalsAreIntact } from "@/lib/epochs/totals";

const H = 3_600_000;
const SOL = 1_000_000_000;
const now = Date.now();
const wallet = () => Keypair.generate().publicKey.toBase58();

// An epoch that started 3h ago, took events until 1h ago, and is now past its snapshot grace period.
const EPOCH = { startTime: now - 3 * H, snapshotTime: now - 1 * H, endTime: now + 1 * H, rewardPool: "1000000000" };
const during = now - 2 * H;
const after = now - 30 * 60_000;

const award = (w: string, id: string, ts: number, points = 40) =>
  awardPoints({ eventId: `${id}-campaign`, wallet: w, type: "campaign", source: "t", ts, points, reason: "test" });

test("full lifecycle: create -> activate -> award -> snapshot -> calculate -> finalize -> immutable", async () => {
  const created = await createEpoch(EPOCH, now);
  assert.ok(created.ok);
  const id = created.ok ? created.epoch.id : 0;

  const A = wallet();
  const B = wallet();

  // Not ACTIVE yet: nothing can be recorded.
  assert.equal((await award(A, "early-one", during)).reason, "epoch_upcoming");

  assert.ok((await transitionEpoch(id, "ACTIVE", now)).ok);
  assert.equal((await award(A, "evt-one", during, 100)).outcome, "recorded");
  assert.equal((await award(A, "evt-one", during, 100)).outcome, "duplicate", "same event twice");
  assert.equal((await award(B, "evt-two", during, 30)).outcome, "recorded");
  assert.equal((await award(A, "evt-three", during, 20)).outcome, "recorded");

  // Events are placed by their OWN time: after the snapshot boundary they belong to no epoch.
  assert.equal((await award(A, "late-one", after)).reason, "no_epoch_for_time");
  assert.equal((await award("not-a-wallet", "evt-x1", during)).reason, "bad_wallet");

  assert.equal(walletTotal(await getWalletDoc(id, A)), 120);

  // Calculating comes only after the snapshot; skipping steps is refused.
  assert.equal((await transitionEpoch(id, "FINALIZED", now)).ok, false, "can't skip to FINALIZED");
  assert.equal((await finalizeEpoch(id, now)).ok, false, "finalize needs CALCULATING");
  assert.ok((await transitionEpoch(id, "SNAPSHOT", now)).ok);
  assert.equal((await award(B, "evt-late-two", during)).reason, "epoch_snapshot", "closed for new events");
  assert.ok((await transitionEpoch(id, "CALCULATING", now)).ok);

  const fin = await finalizeEpoch(id, now);
  assert.ok(fin.ok);
  if (!fin.ok) return;
  assert.equal(fin.totals.totalPoints, 150);
  assert.deepEqual(fin.totals.entries.map((e) => e.points).sort((a, b) => a - b), [30, 120]);
  assert.equal(fin.epoch.status, "FINALIZED");
  assert.equal(fin.epoch.totalsHash, fin.totals.hash);

  // Pinned and verifiable.
  const stored = await getTotals(id);
  assert.ok(stored && totalsAreIntact(stored));
  assert.equal(stored?.hash, fin.totals.hash);

  // Immutable afterwards: no more events, no rollbacks, no second finalize.
  assert.equal((await award(A, "evt-after-fin", during)).reason, "epoch_finalized");
  assert.equal((await transitionEpoch(id, "ACTIVE", now)).ok, false);
  assert.equal((await transitionEpoch(id, "PAUSED", now)).ok, false);
  assert.equal((await finalizeEpoch(id, now)).ok, false);
  assert.equal(walletTotal(await getWalletDoc(id, A)), 120, "wallet document unchanged");
});

test("tampered stored totals are refused and never trusted", async () => {
  const epochs = await getEpochs();
  const id = epochs[epochs.length - 1].id;
  const raw = await docRead<EpochTotals | null>(`points/totals/${id}.json`, null);
  assert.ok(raw);
  assert.equal(totalsAreIntact(raw), true);
  assert.equal(totalsAreIntact({ ...raw, totalPoints: 999999 }), false);
  assert.equal(totalsAreIntact({ ...raw, entries: raw.entries.map((e) => ({ ...e, points: e.points + 1 })) }), false);
});

test("pausing an ACTIVE epoch stops new events until it resumes", async () => {
  const later = { startTime: now + 2 * H, snapshotTime: now + 10 * H, endTime: now + 12 * H, rewardPool: "5" };
  const r = await createEpoch(later, now);
  assert.ok(r.ok);
  const id = r.ok ? r.epoch.id : 0;
  assert.equal((await transitionEpoch(id, "ACTIVE", now)).ok, false, "before its start time");
  // Move "now" forward for the activation check only.
  const future = now + 3 * H;
  assert.ok((await transitionEpoch(id, "ACTIVE", future)).ok);
  const W = wallet();
  const ts = now + 4 * H;
  assert.equal((await award(W, "p-one", ts)).outcome, "recorded");
  assert.ok((await transitionEpoch(id, "PAUSED", future)).ok);
  assert.equal((await award(W, "p-two", ts)).reason, "epoch_paused");
  assert.equal((await transitionEpoch(id, "SNAPSHOT", future)).ok, false, "a paused epoch can only resume to where it was");
  assert.ok((await transitionEpoch(id, "ACTIVE", future)).ok);
  assert.equal((await award(W, "p-two", ts)).outcome, "recorded");
});

test("overlapping or invalid epochs are refused; trades award through the same path", async () => {
  assert.equal((await createEpoch({ ...EPOCH, startTime: now - 2 * H }, now)).ok, false, "overlap");
  const W = wallet();
  const r = await awardPoints({
    eventId: "sig-abc-1:3:trade",
    wallet: W,
    type: "trade",
    source: "trade:MINT",
    ts: now + 5 * H,
    volumeLamports: 4 * SOL,
    reason: "t",
  });
  assert.equal(r.outcome, "recorded");
  assert.equal(r.awarded, 63); // isqrt(4000) = 63
});
