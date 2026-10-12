import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { creatorVaultPda, feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { firstBuyInstructions, widenMaxCost } from "./first-buy";

const key = () => Keypair.generate().publicKey;

function buyIx(amount: bigint, maxCost: bigint): TransactionInstruction {
  const data = Buffer.alloc(25);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(maxCost, 16);
  data[24] = 1;
  return new TransactionInstruction({ programId: key(), keys: [{ pubkey: key(), isSigner: false, isWritable: true }], data });
}

test("widenMaxCost: raises the cost ceiling to PANDA's slippage and touches nothing else", () => {
  const ix = buyIx(BigInt(1_000), BigInt(101_000_000));
  const out = widenMaxCost(ix, BigInt(1_000), BigInt(100_000_000), 5);
  assert.equal(out.data.readBigUInt64LE(16), BigInt(105_000_000));
  assert.equal(out.data.readBigUInt64LE(8), BigInt(1_000));
  assert.equal(out.data[24], 1);
  assert.deepEqual(out.keys, ix.keys);
  assert.ok(out.programId.equals(ix.programId));
  // The original is not modified.
  assert.equal(ix.data.readBigUInt64LE(16), BigInt(101_000_000));
  // Never lowered: a ceiling the SDK already set higher than ours is kept.
  assert.equal(widenMaxCost(buyIx(BigInt(1_000), BigInt(101_000_000)), BigInt(1_000), BigInt(100_000_000), 0.5).data.readBigUInt64LE(16), BigInt(101_000_000));
});

test("widenMaxCost: refuses an instruction that isn't shaped as expected", () => {
  // another amount at the amount's place
  assert.throws(() => widenMaxCost(buyIx(BigInt(999), BigInt(101_000_000)), BigInt(1_000), BigInt(100_000_000), 5), /layout/);
  // a ceiling under the cost, or far over it
  assert.throws(() => widenMaxCost(buyIx(BigInt(1_000), BigInt(99_000_000)), BigInt(1_000), BigInt(100_000_000), 5), /layout/);
  assert.throws(() => widenMaxCost(buyIx(BigInt(1_000), BigInt(200_000_000)), BigInt(1_000), BigInt(100_000_000), 5), /layout/);
  // too short
  assert.throws(() => widenMaxCost(new TransactionInstruction({ programId: key(), keys: [], data: Buffer.alloc(16) }), BigInt(1), BigInt(1), 5), /data/);
});

// Pump.fun's Global as it is on mainnet (the fields a create-and-buy reads), with made-up recipients.
function sampleGlobal() {
  const many = (n: number) => Array.from({ length: n }, key);
  return {
    initialized: true,
    authority: key(),
    feeRecipient: key(),
    initialVirtualTokenReserves: new BN("1073000000000000"),
    initialVirtualSolReserves: new BN("30000000000"),
    initialRealTokenReserves: new BN("793100000000000"),
    tokenTotalSupply: new BN("1000000000000000"),
    feeBasisPoints: new BN(95),
    withdrawAuthority: key(),
    enableMigrate: true,
    poolMigrationFee: new BN(15000001),
    creatorFeeBasisPoints: new BN(5),
    feeRecipients: many(7),
    setCreatorAuthority: key(),
    adminSetCreatorAuthority: key(),
    createV2Enabled: true,
    whitelistPda: key(),
    reservedFeeRecipient: key(),
    mayhemModeEnabled: true,
    reservedFeeRecipients: many(7),
    isCashbackEnabled: false,
    buybackFeeRecipients: many(8),
    buybackBasisPoints: new BN(0),
    creatorFeeConfigurable: true,
    maxConfigurableCreatorFeeBps: 300,
    isHolderRewardEnabled: false,
  };
}

test("firstBuyInstructions: the buy that follows a PANDA launch — creator fees go to the coin's SharingConfig vault", async () => {
  const mint = key();
  const user = key();
  const sol = BigInt(500_000_000);
  const ixs = await firstBuyInstructions({ global: sampleGlobal() as never, feeConfig: null, mint, user, solLamports: sol });
  // The creator's token account, then the buy: no creation among them.
  assert.equal(ixs.length, 2);
  const buy = ixs[1];
  const accounts = buy.keys.map((k) => k.pubkey.toBase58());
  assert.ok(accounts.includes(mint.toBase58()));
  assert.ok(accounts.includes(user.toBase58()));
  assert.ok(accounts.includes(creatorVaultPda(feeSharingConfigPda(mint)).toBase58()), "the SharingConfig's creator vault");
  assert.ok(!accounts.includes(creatorVaultPda(user).toBase58()), "not the creator's own vault");
  // Only the buyer signs it.
  assert.deepEqual(buy.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()), [user.toBase58()]);
  // At most the amount plus PANDA's slippage (5%).
  assert.equal(buy.data.readBigUInt64LE(16), (sol * BigInt(105)) / BigInt(100));
  assert.ok(buy.data.readBigUInt64LE(8) > BigInt(0));
  await assert.rejects(firstBuyInstructions({ global: sampleGlobal() as never, feeConfig: null, mint, user, solLamports: BigInt(0) }), /too small/);
});

test("create form: one approval for the launch and the first buy, sent in order, each simulated first; a failed first buy can be retried", () => {
  const src = readFileSync("src/app/create/CreateClient.tsx", "utf8");
  assert.match(src, /signAllTransactions\(\[launchTx, buyTx\]\)/);
  // The mint signs the launch before the wallet does; the wallet is asked once.
  assert.ok(src.indexOf("launchTx.sign([mint])") < src.indexOf("signAllTransactions([launchTx, buyTx])"));
  assert.match(src, /sendSigned\(connection, signedLaunch\)/);
  assert.match(src, /sendSigned\(connection, signedBuy\)/);
  assert.match(src, /retryFirstBuy/);
  const batch = readFileSync("src/lib/pump/send-signed.ts", "utf8");
  assert.ok(batch.indexOf("simulateTransaction") < batch.indexOf("sendRawTransaction"), "simulated before it is sent");
  // The server only adds the buy to a launch that is one transaction, and never fails a launch over it.
  const route = readFileSync("src/app/api/pump/create/route.ts", "utf8");
  assert.match(route, /combined[\s\S]{0,400}buildFirstBuyTransaction/);
});
