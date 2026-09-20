import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { awardPoints, createEpoch, finalizeEpoch, getEpochs, transitionEpoch } from "@/lib/points/store";
import { docRead, docUpdate } from "@/lib/storage/store";
import type { AllocationSet } from "./allocate";
import { leafHash, verifyProof } from "./merkle";
import { getWalletAllocation, loadVerifiedAllocation, outstandingBaseUnits, publishAirdrop, treeFor, updateClaim } from "./store";
import { claimAirdrop } from "./engine";

const H = 3_600_000;
const now = Date.now();
const wallets = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
const funded = async () => null;

/** Creates an epoch, gives wallets points, and walks it to FINALIZED. `at` shifts the whole timeline. */
async function finalizedEpoch(at: number, pool: string, points: number[]) {
  const created = await createEpoch({ startTime: at, snapshotTime: at + 2 * H, endTime: at + 3 * H, rewardPool: pool }, now);
  assert.ok(created.ok);
  const id = created.ok ? created.epoch.id : 0;
  const later = at + 10 * H;
  assert.ok((await transitionEpoch(id, "ACTIVE", at)).ok);
  for (const [i, p] of points.entries()) {
    const r = await awardPoints({ eventId: `e${id}-w${i}-campaign`, wallet: wallets[i], type: "campaign", source: "t", ts: at + H, points: p, reason: "t" });
    assert.equal(r.outcome, "recorded");
  }
  assert.ok((await transitionEpoch(id, "SNAPSHOT", later)).ok);
  assert.ok((await transitionEpoch(id, "CALCULATING", later)).ok);
  assert.ok((await finalizeEpoch(id, later)).ok);
  return { id, later };
}

test("publish: allocations, Merkle root and hashes are pinned; every wallet's proof verifies against the public root", async () => {
  const { id, later } = await finalizedEpoch(now + 100 * H, "1000000", [10, 30, 60]);
  const r = await publishAirdrop(id, later, funded);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.epoch.status, "DISTRIBUTING");
  assert.equal(r.epoch.merkleRoot, r.merkleRoot);
  assert.equal(r.epoch.allocationHash, r.allocation.allocationHash);
  assert.equal(r.epoch.airdropLeafCount, 3);
  assert.deepEqual(r.allocation.entries.map((e) => e.amount).sort(), ["100000", "300000", "600000"]);

  const epoch = (await getEpochs()).find((e) => e.id === id)!;
  for (const w of wallets) {
    const a = await getWalletAllocation(epoch, w);
    assert.ok(a && a !== "integrity");
    assert.equal(verifyProof(leafHash(id, w, a.amount.toString()), a.proof, epoch.merkleRoot as string, epoch.airdropLeafCount as number, a.index), true);
  }
  assert.equal(await getWalletAllocation(epoch, Keypair.generate().publicKey.toBase58()), null, "a stranger has no allocation");
});

test("publishing needs FINALIZED, can't be repeated, and an unfunded pool refuses without changing anything", async () => {
  const { id, later } = await finalizedEpoch(now + 200 * H, "5000", [1, 1, 1]);

  const seen: bigint[] = [];
  const refused = await publishAirdrop(id, later, async (needed) => {
    seen.push(needed);
    return "pool is empty";
  });
  assert.equal(refused.ok, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0] >= BigInt(4998), true, "asked the pool to cover at least this epoch's distribution (5000 split 3 ways = 4998)");
  assert.equal((await getEpochs()).find((e) => e.id === id)?.status, "FINALIZED", "unchanged");

  assert.ok((await publishAirdrop(id, later, funded)).ok);
  assert.equal((await publishAirdrop(id, later, funded)).ok, false, "second publish");
  assert.equal((await publishAirdrop(999, later, funded)).ok, false, "unknown epoch");

  // An epoch that hasn't been finalized can't be published.
  const created = await createEpoch({ startTime: now + 300 * H, snapshotTime: now + 302 * H, endTime: now + 303 * H, rewardPool: "1" }, now);
  assert.ok(created.ok);
  assert.equal((await publishAirdrop(created.ok ? created.epoch.id : 0, later, funded)).ok, false);
});

test("tampering with the stored allocation is detected: integrity failure, never trusted", async () => {
  const { id, later } = await finalizedEpoch(now + 400 * H, "9000", [1, 2, 3]);
  const pub = await publishAirdrop(id, later, funded);
  assert.ok(pub.ok);
  const epoch = (await getEpochs()).find((e) => e.id === id)!;
  assert.ok((await loadVerifiedAllocation(epoch)) !== "integrity");

  const original = await docRead<AllocationSet>(`airdrop/allocations/${id}.json`, null as never);

  // An attacker (or a bug) edits an amount in storage.
  await docUpdate<AllocationSet | null, void>(`airdrop/allocations/${id}.json`, null, (set) => {
    if (!set) return { next: set, result: undefined };
    return { next: { ...set, entries: set.entries.map((e, i) => (i === 0 ? { ...e, amount: "8999" } : e)) }, result: undefined };
  });
  assert.equal(await loadVerifiedAllocation(epoch), "integrity");
  assert.equal(await getWalletAllocation(epoch, wallets[0]), "integrity");

  // While any published epoch fails verification, NEW publishes refuse too (fail closed).
  const next = await finalizedEpoch(now + 450 * H, "10", [1, 1, 1]);
  assert.equal((await publishAirdrop(next.id, next.later, funded)).ok, false);

  // Restore the original so later tests start from a healthy store.
  await docUpdate<AllocationSet | null, void>(`airdrop/allocations/${id}.json`, null, () => ({ next: original, result: undefined }));
  assert.notEqual(await loadVerifiedAllocation(epoch), "integrity");
});

test("a second epoch must be able to cover what the first one still owes", async () => {
  const first = await finalizedEpoch(now + 500 * H, "1000", [1, 1, 1]);
  assert.ok((await publishAirdrop(first.id, first.later, funded)).ok);
  const e1 = (await getEpochs()).find((e) => e.id === first.id)!;
  const distributed1 = BigInt((await docRead<AllocationSet>(`airdrop/allocations/${first.id}.json`, null as never)).distributed);
  assert.equal(await outstandingBaseUnits(e1), distributed1);

  const second = await finalizedEpoch(now + 600 * H, "2000", [1, 1, 1]);
  let needed = BigInt(0);
  const r = await publishAirdrop(second.id, second.later, async (n) => {
    needed = n;
    return null;
  });
  assert.ok(r.ok);
  // 2000 split three ways = 1998. The pool must also cover EVERYTHING still owed by every other published epoch.
  const others = (await getEpochs()).filter((e) => e.id !== second.id && e.status === "DISTRIBUTING");
  let owedElsewhere = BigInt(0);
  for (const o of others) owedElsewhere += await outstandingBaseUnits(o);
  assert.equal(needed, BigInt(1998) + owedElsewhere);
  assert.ok(needed >= BigInt(1998) + distributed1, "includes what epoch 1 still owes");

  // Once wallet 0 of epoch 1 is CLAIMED, that amount is no longer owed.
  const amount = (await docRead<AllocationSet>(`airdrop/allocations/${first.id}.json`, null as never)).entries.find((x) => x.wallet === wallets[0])!.amount;
  await updateClaim(first.id, wallets[0], () => ({
    next: { epoch: first.id, wallet: wallets[0], amount, status: "CLAIMED", attempts: 1, signature: "s", updatedAt: 1, history: [] },
    result: null,
  }));
  assert.equal(await outstandingBaseUnits(e1), distributed1 - BigInt(amount));
});

test("end to end on the real store: claim through the engine with a simulated chain pays once and records CLAIMED", async () => {
  const { id, later } = await finalizedEpoch(now + 700 * H, "3000", [1, 1, 1]);
  assert.ok((await publishAirdrop(id, later, funded)).ok);

  let sends = 0;
  let landed = false;
  const deps = {
    getEpoch: async (eid: number) => (await getEpochs()).find((e) => e.id === eid) ?? null,
    getAllocation: async (epoch: Parameters<typeof getWalletAllocation>[0], w: string) => {
      const a = await getWalletAllocation(epoch, w);
      return a === null || a === "integrity" ? a : { amount: a.amount };
    },
    updateClaim,
    chain: {
      prepare: async () => ({
        signature: "sim-signature-1",
        lastValidBlockHeight: 100,
        send: async () => {
          sends++;
          landed = true;
        },
      }),
      status: async () => (landed ? ("confirmed" as const) : ("pending" as const)),
    },
    now: () => Date.now(),
    sleep: async () => {},
    alert: async () => {},
  };

  const results = await Promise.all([1, 2, 3, 4].map(() => claimAirdrop({ epochId: id, wallet: wallets[0] }, deps)));
  assert.equal(sends, 1, "four simultaneous claims, one transfer");
  assert.ok(results.some((r) => r.ok && !r.alreadyClaimed));
  const again = await claimAirdrop({ epochId: id, wallet: wallets[0] }, deps);
  assert.ok(again.ok && again.alreadyClaimed);
  assert.equal(sends, 1);
  assert.equal((await claimAirdrop({ epochId: id, wallet: Keypair.generate().publicKey.toBase58() }, deps)).ok, false, "stranger");
  assert.equal(treeFor((await docRead<AllocationSet>(`airdrop/allocations/${id}.json`, null as never))).count, 3);
});
