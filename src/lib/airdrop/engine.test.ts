import { test } from "node:test";
import assert from "node:assert/strict";
import type { Epoch } from "@/lib/epochs/epoch";
import { ChainStatus, ClaimRecord, REQUESTED_STALE_MS } from "./claim-machine";
import { claimAirdrop, ClaimDeps, ClaimResult } from "./engine";

const W = "WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const AMOUNT = BigInt(1_500_000);

const epochOf = (over: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  startTime: 1,
  snapshotTime: 2,
  endTime: 3,
  rewardPool: "10000000",
  status: "DISTRIBUTING",
  formulaVersion: "v1",
  createdAt: 0,
  merkleRoot: "root",
  ...over,
});

/** A chain whose truth is a hidden set of "landed" transactions, independent of what our bookkeeping believes. */
class FakeChain {
  prepared = new Map<string, { wallet: string; amount: bigint; sent: boolean; landed: boolean; polls: number; expired: boolean }>();
  prepareCalls = 0;
  sendCalls = 0;
  failPrepare = false;
  /** How the next send behaves: ok = accepted and lands; throw_landed = RPC errors but it lands anyway; throw_lost = errors and never lands. */
  sendMode: "ok" | "throw_landed" | "throw_lost" | "ok_lost" = "ok";
  pollsToFinalize = 2;
  private n = 0;

  chain = {
    prepare: async (wallet: string, amount: bigint) => {
      this.prepareCalls++;
      if (this.failPrepare) throw new Error("pool underfunded");
      const signature = `sig-${++this.n}`;
      const entry = { wallet, amount, sent: false, landed: false, polls: 0, expired: false };
      this.prepared.set(signature, entry);
      return {
        signature,
        lastValidBlockHeight: 1000 + this.n,
        send: async () => {
          this.sendCalls++;
          entry.sent = true;
          const mode = this.sendMode;
          entry.landed = mode === "ok" || mode === "throw_landed";
          if (mode === "throw_landed" || mode === "throw_lost") throw new Error("RPC timeout");
        },
      };
    },
    status: async (signature: string): Promise<ChainStatus> => {
      const e = this.prepared.get(signature);
      if (!e) return "pending"; // unknown to us: can't be proven dead yet
      if (e.landed) return ++e.polls >= this.pollsToFinalize ? "confirmed" : "pending";
      return e.expired ? "expired" : "pending";
    },
  };

  /** The blockhashes of everything that hasn't landed have now expired. */
  expireAll() {
    for (const e of this.prepared.values()) if (!e.landed) e.expired = true;
  }
  landedFor(wallet: string) {
    return [...this.prepared.values()].filter((e) => e.wallet === wallet && e.landed).length;
  }
}

function harness(opts: { allocation?: Record<string, bigint> | "integrity"; epoch?: Epoch | null } = {}) {
  const fake = new FakeChain();
  const claims = new Map<string, ClaimRecord>();
  const alerts: string[] = [];
  const hooks: { onSleep?: () => void } = {};
  let clock = 1_000_000;
  const allocation = opts.allocation ?? { [W]: AMOUNT };

  const deps: ClaimDeps = {
    getEpoch: async () => (opts.epoch === undefined ? epochOf() : opts.epoch),
    getAllocation: async (_e, wallet) => {
      if (allocation === "integrity") return "integrity";
      const a = allocation[wallet];
      return a === undefined ? null : { amount: a };
    },
    // Atomic like the ETag-guarded store: read-modify-write happens in one synchronous step.
    updateClaim: async (epoch, wallet, mutate) => {
      await Promise.resolve(); // give concurrent callers a chance to interleave
      const key = `${epoch}:${wallet}`;
      const { next, result } = mutate(structuredClone(claims.get(key) ?? null));
      if (next) claims.set(key, next);
      return result;
    },
    chain: fake.chain,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      hooks.onSleep?.();
    },
    alert: async (event) => {
      alerts.push(event);
    },
  };
  return { fake, claims, alerts, hooks, deps, advance: (ms: number) => (clock += ms), key: `1:${W}` };
}

const claim = (h: ReturnType<typeof harness>, wallet = W, opts?: { maxWaitMs?: number }) => claimAirdrop({ epochId: 1, wallet }, h.deps, opts);
const okOf = (r: ClaimResult) => (r.ok ? r : assert.fail(`expected ok, got ${JSON.stringify(r)}`));

test("happy path: paid once, recorded CLAIMED with the signature, second claim pays nothing", async () => {
  const h = harness();
  const r = okOf(await claim(h));
  assert.equal(r.status, "CLAIMED");
  assert.equal(r.amount, AMOUNT.toString());
  assert.equal(r.alreadyClaimed, false);
  assert.equal(h.fake.prepareCalls, 1);
  assert.equal(h.fake.sendCalls, 1);
  assert.equal(h.claims.get(h.key)?.status, "CLAIMED");
  assert.equal(h.claims.get(h.key)?.signature, r.signature);

  const again = okOf(await claim(h));
  assert.equal(again.alreadyClaimed, true);
  assert.equal(h.fake.prepareCalls, 1, "no second transfer");
  assert.equal(h.fake.sendCalls, 1);
  assert.equal(h.fake.landedFor(W), 1);
});

test("the paid amount is the verified allocation — the caller has no way to influence it", async () => {
  const h = harness({ allocation: { [W]: BigInt(42) } });
  okOf(await claim(h));
  assert.equal([...h.fake.prepared.values()][0].amount, BigInt(42));
});

test("refuses wallets with no allocation, and epochs that aren't distributing", async () => {
  const h = harness();
  assert.equal((await claim(h, OTHER)).ok, false);
  assert.equal(((await claim(h, OTHER)) as { code: string }).code, "NOT_ELIGIBLE");
  for (const status of ["UPCOMING", "ACTIVE", "SNAPSHOT", "CALCULATING", "FINALIZED", "PAUSED", "COMPLETED"] as const) {
    const g = harness({ epoch: epochOf({ status }) });
    assert.equal(((await claim(g)) as { code: string }).code, "NOT_DISTRIBUTING", status);
    assert.equal(g.fake.prepareCalls, 0);
  }
  assert.equal(((await claim(harness({ epoch: null }))) as { code: string }).code, "NOT_DISTRIBUTING");
  assert.equal(((await claim(harness({ epoch: epochOf({ merkleRoot: undefined }) }))) as { code: string }).code, "NOT_DISTRIBUTING", "no root published");
});

test("allocation data that fails verification halts the claim and alerts", async () => {
  const h = harness({ allocation: "integrity" });
  const r = await claim(h);
  assert.equal((r as { code: string }).code, "INTEGRITY");
  assert.equal(h.fake.prepareCalls, 0);
  assert.equal(h.alerts.length, 1);
});

test("a claim record that disagrees with the verified allocation halts the claim", async () => {
  const h = harness();
  okOf(await claim(h));
  const rec = h.claims.get(h.key) as ClaimRecord;
  h.claims.set(h.key, { ...rec, amount: "999999999" });
  const r = await claim(h);
  assert.equal((r as { code: string }).code, "INTEGRITY");
  assert.equal(h.fake.sendCalls, 1);
});

test("ten simultaneous claims for one wallet: exactly one transfer is ever sent", async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 10 }, () => claim(h)));
  assert.equal(h.fake.prepareCalls, 1);
  assert.equal(h.fake.sendCalls, 1);
  assert.equal(h.fake.landedFor(W), 1);
  assert.equal(results.filter((r) => r.ok && !r.alreadyClaimed).length, 1, "one winner");
  assert.ok(results.every((r) => r.ok || ["IN_PROGRESS", "CONFIRMING"].includes(r.code)));
  assert.equal(h.claims.get(h.key)?.status, "CLAIMED");
});

test("simultaneous claims by different wallets don't interfere", async () => {
  const h = harness({ allocation: { [W]: AMOUNT, [OTHER]: BigInt(7) } });
  const [a, b] = await Promise.all([claim(h, W), claim(h, OTHER)]);
  okOf(a);
  okOf(b);
  assert.equal(h.fake.landedFor(W), 1);
  assert.equal(h.fake.landedFor(OTHER), 1);
});

test("prepare fails (pool underfunded): nothing sent, recorded FAILED, alert raised, retry then succeeds", async () => {
  const h = harness();
  h.fake.failPrepare = true;
  const r = await claim(h);
  assert.equal((r as { code: string }).code, "PREPARE_FAILED");
  assert.equal(h.fake.sendCalls, 0);
  assert.equal(h.claims.get(h.key)?.status, "FAILED");
  assert.equal(h.alerts.length, 1);

  h.fake.failPrepare = false;
  const retry = okOf(await claim(h));
  assert.equal(retry.status, "CLAIMED");
  assert.equal(h.claims.get(h.key)?.attempts, 2);
  assert.equal(h.fake.landedFor(W), 1);
});

test("send errors but the transaction DID land: never re-sent, ends CLAIMED, paid exactly once", async () => {
  const h = harness();
  h.fake.sendMode = "throw_landed";
  const first = await claim(h);
  assert.equal((first as { code: string }).code, "SEND_UNCERTAIN");
  assert.equal(h.claims.get(h.key)?.status, "SENT", "stays SENT — the chain decides");

  h.fake.sendMode = "ok"; // even if the network is healthy now, a landed tx must not be re-sent
  const second = await claim(h);
  const third = await claim(h);
  const done = second.ok ? second : third;
  okOf(done);
  assert.equal(h.fake.prepareCalls, 1);
  assert.equal(h.fake.sendCalls, 1);
  assert.equal(h.fake.landedFor(W), 1);
  assert.equal(h.claims.get(h.key)?.status, "CLAIMED");
});

test("send errors and the transaction never lands: only after it EXPIRES may a retry pay — and then it pays once", async () => {
  const h = harness();
  h.fake.sendMode = "throw_lost";
  assert.equal(((await claim(h)) as { code: string }).code, "SEND_UNCERTAIN");

  // Not expired yet: it could still land, so no new attempt is allowed.
  h.fake.sendMode = "ok";
  const early = await claim(h);
  assert.equal((early as { code: string }).code, "CONFIRMING");
  assert.equal(h.fake.prepareCalls, 1, "no second attempt while the first could still land");

  h.fake.expireAll();
  const retry = okOf(await claim(h));
  assert.equal(retry.status, "CLAIMED");
  assert.equal(h.fake.prepareCalls, 2);
  assert.equal(h.fake.landedFor(W), 1, "the lost first attempt never landed; only the second did");
});

test("crash after the signature was saved but before sending: reconciled against the chain, not re-sent early", async () => {
  const h = harness();
  const now = 1_000_000;
  h.claims.set(h.key, {
    epoch: 1,
    wallet: W,
    amount: AMOUNT.toString(),
    status: "SENT",
    attempts: 1,
    signature: "sig-ghost",
    lastValidBlockHeight: 1234,
    updatedAt: now,
    history: [{ status: "SENT", at: now }],
  });
  // The chain has never heard of it (the process died before sending) but its blockhash is still valid.
  h.fake.prepared.set("sig-ghost", { wallet: W, amount: AMOUNT, sent: false, landed: false, polls: 0, expired: false });
  const r = await claim(h);
  assert.equal((r as { code: string }).code, "CONFIRMING");
  assert.equal(h.fake.prepareCalls, 0, "not re-sent while it could still land");
  // Once the blockhash has expired it can never land -> proven unpaid -> a fresh attempt is allowed.
  h.fake.expireAll();
  const later = okOf(await claim(h));
  assert.equal(later.status, "CLAIMED");
  assert.equal(h.fake.landedFor(W), 1);
});

test("crash before the signature was saved: a fresh REQUESTED blocks others, a stale one may restart", async () => {
  const h = harness();
  const seed = (updatedAt: number): ClaimRecord => ({
    epoch: 1,
    wallet: W,
    amount: AMOUNT.toString(),
    status: "REQUESTED",
    attempts: 1,
    updatedAt,
    history: [{ status: "REQUESTED", at: updatedAt }],
  });
  h.claims.set(h.key, seed(1_000_000 - 1000));
  assert.equal(((await claim(h)) as { code: string }).code, "IN_PROGRESS");
  assert.equal(h.fake.prepareCalls, 0);

  h.advance(REQUESTED_STALE_MS + 5000);
  okOf(await claim(h));
  assert.equal(h.claims.get(h.key)?.attempts, 2);
  assert.equal(h.fake.landedFor(W), 1);
});

test("transaction fails on-chain while waiting: FAILED, alert, and a later retry is allowed", async () => {
  const h = harness();
  h.fake.sendMode = "ok_lost"; // accepted by the RPC, never lands
  h.hooks.onSleep = () => h.fake.expireAll(); // while we wait for finality, the blockhash runs out
  const r = await claim(h);
  h.hooks.onSleep = undefined;
  assert.equal((r as { code: string }).code, "FAILED_ONCHAIN");
  assert.equal(h.claims.get(h.key)?.status, "FAILED");
  h.fake.sendMode = "ok";
  okOf(await claim(h));
  assert.equal(h.fake.landedFor(W), 1);
});

test("still confirming when the wait runs out: reported as CONFIRMING, stays SENT, finishes on the next look — paid once", async () => {
  const h = harness();
  h.fake.pollsToFinalize = 50;
  const r = await claim(h, W, { maxWaitMs: 3000 });
  assert.equal((r as { code: string }).code, "CONFIRMING");
  assert.equal(h.claims.get(h.key)?.status, "SENT");
  h.fake.pollsToFinalize = 1;
  const done = okOf(await claim(h));
  assert.equal(done.alreadyClaimed, true);
  assert.equal(h.fake.sendCalls, 1);
  assert.equal(h.fake.landedFor(W), 1);
});

test("FUZZ: under random send failures, crashes, expiries and concurrency, no wallet is ever paid twice — and everyone is eventually paid", async () => {
  let seed = 4242;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const modes = ["ok", "throw_landed", "throw_lost", "ok_lost"] as const;

  for (let run = 0; run < 60; run++) {
    const wallets = [W, OTHER, "WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"];
    const h = harness({ allocation: Object.fromEntries(wallets.map((w) => [w, AMOUNT])) });
    h.fake.pollsToFinalize = 1 + Math.floor(rand() * 3);

    for (let step = 0; step < 25; step++) {
      const roll = rand();
      if (roll < 0.15) h.fake.expireAll();
      else if (roll < 0.25) h.advance(REQUESTED_STALE_MS + 1);
      else {
        h.fake.sendMode = modes[Math.floor(rand() * modes.length)];
        h.fake.failPrepare = rand() < 0.15;
        const batch = wallets.filter(() => rand() < 0.7);
        await Promise.all(batch.flatMap((w) => Array.from({ length: 1 + Math.floor(rand() * 3) }, () => claim(h, w, { maxWaitMs: 2000 }))));
      }
      for (const w of wallets) assert.ok(h.fake.landedFor(w) <= 1, `run ${run} step ${step}: ${w} paid ${h.fake.landedFor(w)} times`);
    }

    // Recovery: healthy network, everything unlanded has expired — every wallet must end up paid, exactly once.
    h.fake.sendMode = "ok";
    h.fake.failPrepare = false;
    h.fake.pollsToFinalize = 1;
    for (let round = 0; round < 6; round++) {
      h.fake.expireAll();
      h.advance(REQUESTED_STALE_MS + 1);
      for (const w of wallets) await claim(h, w, { maxWaitMs: 2000 });
    }
    for (const w of wallets) {
      assert.equal(h.fake.landedFor(w), 1, `run ${run}: ${w} should end paid exactly once`);
      assert.equal(h.claims.get(`1:${w}`)?.status, "CLAIMED", `run ${run}: ${w} record`);
    }
  }
});
