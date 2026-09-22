import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createOtcLaunch, getOtcLaunch, patchOtcLaunch, transitionOtcLaunch } from "./store";

const mint = () => Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
const draft = (m: string) => ({ mint: m, creator, name: "Coin", symbol: "COIN", uri: "https://x/y.json", quoteMint: "Q", mode: "low" as const, buy: "0" });

test("creating twice for the same mint refuses the second — no duplicate launch", async () => {
  const m = mint();
  const first = await createOtcLaunch(draft(m), "METADATA_CREATED", Date.now());
  assert.ok(first);
  assert.equal(first!.status, "METADATA_CREATED");
  const second = await createOtcLaunch(draft(m), "METADATA_CREATED", Date.now());
  assert.equal(second, null, "second create for the same mint is refused");
  assert.equal((await getOtcLaunch(m))!.status, "METADATA_CREATED", "untouched by the refused attempt");
});

test("a transition only applies from the right prior status", async () => {
  const m = mint();
  await createOtcLaunch(draft(m), "METADATA_CREATED", Date.now());

  const wrongFrom = await transitionOtcLaunch(m, ["AWAITING_SIGNATURE"], { status: "LAUNCH_BUILDING" }, Date.now());
  assert.equal(wrongFrom, null, "can't skip LAUNCH_BUILDING");
  assert.equal((await getOtcLaunch(m))!.status, "METADATA_CREATED", "unchanged");

  const ok = await transitionOtcLaunch(m, ["METADATA_CREATED"], { status: "LAUNCH_BUILDING" }, Date.now());
  assert.equal(ok!.status, "LAUNCH_BUILDING");
});

test("full happy path to CONFIRMED, then registration is a separate, idempotent flag", async () => {
  const m = mint();
  await createOtcLaunch(draft(m), "METADATA_CREATED", Date.now());
  await transitionOtcLaunch(m, ["METADATA_CREATED"], { status: "LAUNCH_BUILDING" }, Date.now());
  await transitionOtcLaunch(m, ["LAUNCH_BUILDING"], { status: "AWAITING_SIGNATURE", config: "cfg", blockhash: "bh", lastValidBlockHeight: 1 }, Date.now());
  await transitionOtcLaunch(m, ["AWAITING_SIGNATURE"], { status: "TX1_PENDING", tx1Signature: "sig1" }, Date.now());
  await transitionOtcLaunch(m, ["TX1_PENDING"], { status: "TX1_CONFIRMED" }, Date.now());
  await transitionOtcLaunch(m, ["TX1_CONFIRMED"], { status: "TX2_PENDING", tx2Signature: "sig2" }, Date.now());
  const confirmed = await transitionOtcLaunch(m, ["TX2_PENDING"], { status: "CONFIRMED" }, Date.now());
  assert.equal(confirmed!.status, "CONFIRMED");
  assert.equal(confirmed!.tx2Signature, "sig2");
  assert.equal(confirmed!.registered, false);

  const registered = await patchOtcLaunch(m, { registered: true }, Date.now());
  assert.equal(registered!.registered, true);
  assert.equal(registered!.status, "CONFIRMED", "registering never changes the launch status");
});

test("FAILED can't overwrite a launch that already sent TX2 — the coin may already be real", async () => {
  const m = mint();
  await createOtcLaunch(draft(m), "METADATA_CREATED", Date.now());
  await transitionOtcLaunch(m, ["METADATA_CREATED"], { status: "LAUNCH_BUILDING" }, Date.now());
  await transitionOtcLaunch(m, ["LAUNCH_BUILDING"], { status: "AWAITING_SIGNATURE" }, Date.now());
  await transitionOtcLaunch(m, ["AWAITING_SIGNATURE"], { status: "TX1_PENDING", tx1Signature: "sig1" }, Date.now());
  await transitionOtcLaunch(m, ["TX1_PENDING"], { status: "TX1_CONFIRMED" }, Date.now());
  await transitionOtcLaunch(m, ["TX1_CONFIRMED"], { status: "TX2_PENDING", tx2Signature: "sig2" }, Date.now());

  // The "failed" event's own allow-list (src/app/api/otc/launch/status/route.ts) never includes TX2_PENDING —
  // simulated here directly against the store's transition guard.
  const blocked = await transitionOtcLaunch(m, ["VALIDATING", "METADATA_CREATED", "LAUNCH_BUILDING", "AWAITING_SIGNATURE", "TX1_PENDING", "TX1_CONFIRMED"], { status: "FAILED" }, Date.now());
  assert.equal(blocked, null);
  assert.equal((await getOtcLaunch(m))!.status, "TX2_PENDING", "tx2Signature preserved, not lost to a stray FAILED");
});

test("patching a mint with no record does nothing", async () => {
  const m = mint();
  assert.equal(await patchOtcLaunch(m, { registered: true }, Date.now()), null);
  assert.equal(await transitionOtcLaunch(m, ["METADATA_CREATED"], { status: "LAUNCH_BUILDING" }, Date.now()), null);
  assert.equal(await getOtcLaunch(m), null);
});
