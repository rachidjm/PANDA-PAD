import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { getPendingFeeLocks, hasPandaShare, registerPendingFeeLock, resolvePending, withoutPendingFeeLock } from "./fee-lock";
import { PANDA_TREASURY } from "./constants";
import { listAudit } from "@/lib/audit/log";

const TREASURY = PANDA_TREASURY.toBase58();
const newMint = () => Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const split = [{ address: TREASURY, shareBps: 500 }, { address: creator, shareBps: 9500 }];

/** A chain with only the accounts we say exist. Sizes of lists it returns are irrelevant to these tests. */
const chain = (existing: Set<string>) =>
  ({
    getAccountInfo: async (k: { toBase58(): string }) => (existing.has(k.toBase58()) ? { data: Buffer.alloc(0) } : null),
    getMultipleAccountsInfo: async (ks: { toBase58(): string }[]) => ks.map((k) => (existing.has(k.toBase58()) ? { data: Buffer.alloc(0) } : null)),
  }) as unknown as Connection;
const noRegister = async () => {};

test("a coin waiting for its fee split is left out of every list, and other coins are not", async () => {
  const waiting = newMint();
  const other = newMint();
  assert.deepEqual(await registerPendingFeeLock(chain(new Set()), { mint: waiting, creator, shareholders: split }), { ok: true });
  const shown = await withoutPendingFeeLock([{ mint: waiting }, { mint: other }]);
  assert.deepEqual(shown, [{ mint: other }]);
});

test("SECURITY: a coin that already exists on-chain can't be registered (nobody can hide someone else's coin through the open build endpoint)", async () => {
  const someoneElses = newMint();
  const r = await registerPendingFeeLock(chain(new Set([someoneElses])), { mint: someoneElses, creator, shareholders: split });
  assert.deepEqual(r, { ok: false, reason: "exists" });
  assert.deepEqual(await withoutPendingFeeLock([{ mint: someoneElses }]), [{ mint: someoneElses }]);
});

test("a coin created without its split stays hidden and is audited exactly once, however often it is checked", async () => {
  const mint = newMint();
  await registerPendingFeeLock(chain(new Set()), { mint, creator, shareholders: split });
  const onChain = chain(new Set([mint])); // the coin now exists, still without a SharingConfig
  const noSharing = { readSharing: async () => null, register: noRegister };
  for (let i = 0; i < 3; i++) {
    const r = await resolvePending(onChain, mint, noSharing);
    assert.equal(r.state, "waiting");
    assert.equal(r.state === "waiting" && r.created, true);
  }
  const events = (await listAudit(100)).filter((e) => e.object === mint && e.action === "token.created_without_fee_split");
  assert.equal(events.length, 1);
  assert.equal((events[0].newState as { creator: string }).creator, creator);
  assert.deepEqual(await withoutPendingFeeLock([{ mint }]), [], "still hidden");
});

test("a coin whose creation never happened stays registered but is not reported as created (nothing to fix yet, no audit)", async () => {
  const mint = newMint();
  await registerPendingFeeLock(chain(new Set()), { mint, creator, shareholders: split });
  const r = await resolvePending(chain(new Set()), mint, { readSharing: async () => null, register: noRegister });
  assert.equal(r.state === "waiting" && r.created, false);
  assert.equal((await listAudit(100)).filter((e) => e.object === mint).length, 0);
});

test("once the on-chain split contains PANDA's share the coin comes back into the lists and is registered for fee collection", async () => {
  const mint = newMint();
  await registerPendingFeeLock(chain(new Set()), { mint, creator, shareholders: split });
  const registered: string[] = [];
  const r = await resolvePending(chain(new Set([mint])), mint, { readSharing: async () => split, register: async (m) => void registered.push(m) });
  assert.equal(r.state, "locked");
  assert.deepEqual(registered, [mint]);
  assert.deepEqual(await withoutPendingFeeLock([{ mint }]), [{ mint }]);
  assert.ok(!(mint in (await getPendingFeeLocks())));
  assert.equal((await listAudit(100)).filter((e) => e.object === mint && e.action === "token.fee_split_locked").length, 1);
});

test("a SharingConfig WITHOUT PANDA's 5% does not release the coin (it must be PANDA's share, not any split)", async () => {
  const mint = newMint();
  await registerPendingFeeLock(chain(new Set()), { mint, creator, shareholders: split });
  const r = await resolvePending(chain(new Set([mint])), mint, { readSharing: async () => [{ address: creator, shareBps: 10_000 }], register: noRegister });
  assert.equal(r.state, "waiting");
  assert.deepEqual(await withoutPendingFeeLock([{ mint }]), []);
});

test("hasPandaShare needs PANDA's treasury with at least its locked share", () => {
  assert.equal(hasPandaShare(split), true);
  assert.equal(hasPandaShare([{ address: TREASURY, shareBps: 499 }, { address: creator, shareBps: 9501 }]), false);
  assert.equal(hasPandaShare([{ address: creator, shareBps: 10_000 }]), false);
  assert.equal(hasPandaShare(null), false);
});

test("an unregistered mint resolves to none, so a normal coin page costs no chain read", async () => {
  const boom = { getAccountInfo: async () => { throw new Error("must not be called"); } } as unknown as Connection;
  assert.deepEqual(await resolvePending(boom, newMint()), { state: "none" });
});
