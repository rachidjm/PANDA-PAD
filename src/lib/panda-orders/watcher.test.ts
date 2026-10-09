import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pandaOrders } from "@/lib/db/schema";
import { pgListOrders } from "@/lib/db/panda-orders";
import { sealTx } from "./crypto";
import { runWatcher } from "./watcher";
import { deriveOrderNotifications } from "./notifications";
import { fakeVenue, newChain, nonceInfo, randomNonceValue, TEST_ENV, watchDeps, type Chain, type FakeVenue, type SimResult } from "./testing";

/**
 * The watcher on a real Postgres (PGlite) with a fake chain and a fake clock: it sends ONLY the user's own bytes, only
 * when the level is reached and the simulation passes; it records what really happened; and it never invalidates an
 * order for a reason that doesn't make it invalid.
 */

let db: Db;
before(async () => {
  db = await newTestDb();
});

const OK: SimResult = { err: null, logs: [] };
const SLIPPAGE: SimResult = { err: { InstructionError: [3, { Custom: 6003 }] }, logs: ["Error Code: TooLittleSolReceived."] };

/** Inserts an ACTIVE order (sell or stop) with sealed "signed bytes" — `amount` tokens, trigger in lamports. */
async function addOrder(chain: Chain, o: { wallet: string; mint: string; nonce: string; nonceValue: string; leg: "sell" | "stop"; amount: number; trigger: number; venue?: "curve" | "amm" }) {
  const id = randomUUID();
  const bytes = new Uint8Array(Buffer.from(`signed:${id}`));
  const sealed = sealTx(id, bytes, TEST_ENV)!;
  const signature = bs58.encode(Buffer.from(id.replace(/-/g, "").padEnd(64, "0"), "hex"));
  await db.insert(pandaOrders).values({
    id,
    wallet: o.wallet,
    mint: o.mint,
    ticker: "TST",
    groupId: "group-watch",
    trancheId: `t-${o.nonce.slice(0, 6)}`,
    n: 1,
    leg: o.leg,
    venue: o.venue ?? "curve",
    pool: null,
    pct: 50,
    nonceAccount: o.nonce,
    nonceValue: o.nonceValue,
    tokenAmountRaw: String(o.amount),
    tokenDecimals: 6,
    triggerOutLamports: o.trigger,
    minOutLamports: Math.floor(o.trigger * 0.97),
    feeLamports: 1,
    targetUsd: 1,
    refUsd: 1,
    state: "active",
    messageHash: "h",
    txCiphertext: sealed.ciphertext,
    txIv: sealed.iv,
    signature,
    createdAt: 1,
    updatedAt: 1,
  });
  return { id, signature, bytes };
}

/** One tranche: a sell at 2× and a stop at 0.5× on the same nonce; selling `amount` pays `amount` lamports at price 1. */
async function tranche(price = 1) {
  const chain = newChain(fakeVenue("curve", price));
  const wallet = Keypair.generate().publicKey;
  const mint = (chain.venue as FakeVenue).mint.toBase58();
  const nonce = Keypair.generate().publicKey.toBase58();
  const nonceValue = randomNonceValue();
  chain.accounts.set(nonce, nonceInfo(wallet, nonceValue));
  const sell = await addOrder(chain, { wallet: wallet.toBase58(), mint, nonce, nonceValue, leg: "sell", amount: 1000, trigger: 2000 });
  const stop = await addOrder(chain, { wallet: wallet.toBase58(), mint, nonce, nonceValue, leg: "stop", amount: 1000, trigger: 500 });
  return { chain, wallet, mint, nonce, sell, stop };
}

const state = async (id: string) => (await pgListOrders(db, "", undefined)).find((o) => o.id === id) ?? (await db.select().from(pandaOrders)).find((o) => o.id === id)!;

test("nothing reached: nothing is sent (a take-profit's health check failing on 'slippage' is normal, not a problem)", async () => {
  const t = await tranche(1);
  const deps = watchDeps(db, t.chain, (bytes) => (Buffer.from(bytes).toString().endsWith(t.sell.id) ? SLIPPAGE : OK));
  await runWatcher(deps, 3_000);
  assert.equal(deps.sent.length, 0);
  assert.equal((await state(t.sell.id)).state, "active");
  assert.equal((await state(t.stop.id)).state, "active");
});

test("the sell's level is reached and its simulation passes → the user's OWN bytes are sent; once it lands: executed, and the stop (same nonce) is over (OCO)", async () => {
  const t = await tranche(2.5); // selling 1000 now pays 2500 ≥ 2000
  const deps = watchDeps(db, t.chain, () => OK);
  await runWatcher(deps, 1_000);
  assert.equal(deps.sent.length, 1);
  assert.deepEqual(Buffer.from(deps.sent[0]), Buffer.from(t.sell.bytes), "exactly what the user signed, byte for byte");
  assert.equal((await state(t.sell.id)).state, "sending");
  t.chain.landed.set(t.sell.signature, true);
  await runWatcher(deps, 1_000);
  const sold = await state(t.sell.id);
  assert.equal(sold.state, "executed");
  assert.equal(sold.txCiphertext, null, "the signed bytes are wiped once final");
  const twin = await state(t.stop.id);
  assert.equal(twin.state, "cancelled");
  assert.equal(twin.reason, "oco");
  const notes = deriveOrderNotifications([sold].map((o) => ({ ...o, state: o.state })));
  assert.equal(notes[0]?.kind, "panda_sell");
});

test("a stop reached in a crash that can't pay its minimum is NOT sold: it stays active and the user is told (slippage notice)", async () => {
  const t = await tranche(0.3); // 1000 tokens pay 300 ≤ 500: the stop is due
  const deps = watchDeps(db, t.chain, () => SLIPPAGE);
  await runWatcher(deps, 1_000);
  assert.equal(deps.sent.length, 0, "never sent when the simulation says it would fail");
  const s = await state(t.stop.id);
  assert.equal(s.state, "active");
  assert.equal(s.notice, "stop_slippage");
  assert.equal(deriveOrderNotifications([s])[0]?.kind, "panda_slippage");
});

test("the coin graduated off the curve → every curve order on it needs re-signing (told in the bell)", async () => {
  const t = await tranche(1);
  (t.chain.venue as FakeVenue).fake.migrated = true;
  const deps = watchDeps(db, t.chain, () => OK);
  await runWatcher(deps, 1_000);
  for (const id of [t.sell.id, t.stop.id]) {
    const o = await state(id);
    assert.equal(o.state, "needs_resign");
    assert.equal(o.reason, "migrated");
  }
});

test("Pump changed its program / the tokens are gone → re-sign; an unexplained failure on a health check never retires an order", async () => {
  const t = await tranche(1);
  const deps = watchDeps(db, t.chain, (bytes) =>
    Buffer.from(bytes).toString().endsWith(t.sell.id) ? { err: { InstructionError: [3, { Custom: 6000 }] }, logs: ["Error Code: NotAuthorized."] } : { err: { InstructionError: [9, "X"] }, logs: [] }
  );
  await runWatcher(deps, 1_000);
  assert.equal((await state(t.sell.id)).state, "needs_resign");
  assert.equal((await state(t.sell.id)).reason, "program_changed");
  assert.equal((await state(t.stop.id)).state, "active", "unknown failure on a health check: no strike");
});

test("the nonce moved and one leg's signature landed → that leg executed, the other is over; nothing landed → cancelled", async () => {
  const a = await tranche(1);
  a.chain.accounts.set(a.nonce, nonceInfo(a.wallet, randomNonceValue())); // advanced
  a.chain.landed.set(a.stop.signature, true);
  await runWatcher(watchDeps(db, a.chain, () => OK), 1_000);
  assert.equal((await state(a.stop.id)).state, "executed");
  assert.equal((await state(a.sell.id)).reason, "oco");

  const b = await tranche(1);
  b.chain.accounts.set(b.nonce, null); // the user closed it outside PANDA
  await runWatcher(watchDeps(db, b.chain, () => OK), 1_000);
  assert.equal((await state(b.sell.id)).state, "cancelled");
  assert.equal((await state(b.sell.id)).reason, "nonce_used");
});

test("a signed order that can't be decrypted is never guessed at: it stays as it is and ops are alerted", async () => {
  const t = await tranche(2.5);
  const deps = watchDeps(db, t.chain, () => OK, { open: () => null });
  await runWatcher(deps, 1_000);
  assert.equal(deps.sent.length, 0);
  assert.equal((await state(t.sell.id)).state, "active");
  assert.ok(deps.alerts.length > 0);
});

test("a sent order that failed ON-CHAIN can't be retried (its nonce moved): re-sign", async () => {
  const t = await tranche(2.5);
  const deps = watchDeps(db, t.chain, () => OK);
  await runWatcher(deps, 1_000);
  t.chain.landed.set(t.sell.signature, false);
  await runWatcher(deps, 1_000);
  assert.equal((await state(t.sell.id)).state, "needs_resign");
  assert.equal((await state(t.sell.id)).reason, "failed_onchain");
});
