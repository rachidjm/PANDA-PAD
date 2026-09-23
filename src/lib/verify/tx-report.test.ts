import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { buildReport } from "./tx-report";

const k = () => Keypair.generate().publicKey;
const TOKEN = k().toBase58();
const NETWORK_FEE = 5_000;
const RENT = 2_039_280;

type Account = { key: PublicKey; signer?: boolean; pre: number; post: number };

/** A parsed transaction in the shape web3.js returns, from a list of accounts and instructions. */
function makeTx(args: { accounts: Account[]; transfers?: { source: PublicKey; destination: PublicKey; lamports: number }[]; wallet: PublicKey; tokenDelta?: number; err?: unknown }): ParsedTransactionWithMeta {
  const { accounts, transfers = [], wallet, tokenDelta = 0, err = null } = args;
  const instructions = [
    { programId: new PublicKey("ComputeBudget111111111111111111111111111111"), accounts: [], data: "" },
    ...transfers.map((t) => ({ program: "system", programId: new PublicKey("11111111111111111111111111111111"), parsed: { type: "transfer", info: { source: t.source.toBase58(), destination: t.destination.toBase58(), lamports: t.lamports } } })),
    { programId: new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), accounts: [], data: "" },
  ];
  return {
    slot: 123,
    blockTime: 1_780_000_000,
    version: 0,
    transaction: {
      signatures: ["sig"],
      message: { accountKeys: accounts.map((a) => ({ pubkey: a.key, signer: !!a.signer, writable: true, source: "transaction" })), instructions, recentBlockhash: "x" },
    },
    meta: {
      err,
      fee: NETWORK_FEE,
      preBalances: accounts.map((a) => a.pre),
      postBalances: accounts.map((a) => a.post),
      preTokenBalances: [],
      postTokenBalances: tokenDelta === 0 ? [] : [{ accountIndex: 1, mint: TOKEN, owner: wallet.toBase58(), uiTokenAmount: { amount: "0", decimals: 6, uiAmount: tokenDelta > 0 ? tokenDelta : 0 } }],
      computeUnitsConsumed: 90_000,
      innerInstructions: [],
      logMessages: [],
    },
  } as unknown as ParsedTransactionWithMeta;
}

const opts = (treasury: PublicKey, wallet?: PublicKey) => ({ treasury: treasury.toBase58(), feeBps: 50, wallet: wallet?.toBase58() });

function buyTx(treasury: PublicKey, wallet: PublicKey, { amount, fee, treasuryPre = 2_000_000 }: { amount: number; fee: number; treasuryPre?: number }) {
  const ata = k();
  const pool = k();
  return makeTx({
    wallet,
    tokenDelta: 1_000,
    accounts: [
      { key: wallet, signer: true, pre: 1_000_000_000, post: 1_000_000_000 - amount - fee - NETWORK_FEE - RENT },
      { key: ata, pre: 0, post: RENT },
      { key: pool, pre: 5_000_000_000, post: 5_000_000_000 + amount },
      { key: treasury, pre: treasuryPre, post: treasuryPre + fee },
    ],
    transfers: fee > 0 ? [{ source: wallet, destination: treasury, lamports: fee }] : [],
  });
}

test("a buy whose fee is exactly 0.5% of the trade matches — new-account rent is not counted as part of the trade", () => {
  const wallet = k();
  const treasury = k();
  const r = buildReport(buyTx(treasury, wallet, { amount: 50_000_000, fee: 250_000 }), "sig", opts(treasury));
  assert.equal(r.status, "success");
  assert.equal(r.trade?.side, "buy");
  assert.equal(r.trade?.baseLamports, 50_000_000);
  assert.equal(r.fee.expectedLamports, 250_000);
  assert.equal(r.fee.actualLamports, 250_000);
  assert.equal(r.fee.verdict, "match");
  assert.equal(r.treasury.balanceDeltaLamports, 250_000, "the treasury's real balance change agrees with the transfer");
  assert.equal(r.feePayer, wallet.toBase58());
  assert.equal(r.computeUnits, 90_000);
});

test("a sell: the fee is 0.5% of the gross proceeds, and rent refunded by a closed account is not counted", () => {
  const wallet = k();
  const treasury = k();
  const closedAta = k();
  const pool = k();
  const proceeds = 40_000_000;
  const fee = 200_000;
  const tx = makeTx({
    wallet,
    tokenDelta: -1, // (set below: a sell has the wallet's token balance go DOWN)
    accounts: [
      { key: wallet, signer: true, pre: 1_000_000_000, post: 1_000_000_000 + proceeds - fee - NETWORK_FEE + RENT },
      { key: closedAta, pre: RENT, post: 0 },
      { key: pool, pre: 5_000_000_000, post: 5_000_000_000 - proceeds },
      { key: treasury, pre: 2_000_000, post: 2_000_000 + fee },
    ],
    transfers: [{ source: wallet, destination: treasury, lamports: fee }],
  });
  // a sell: 1000 tokens before, 0 after
  (tx.meta as unknown as { preTokenBalances: unknown[] }).preTokenBalances = [{ accountIndex: 1, mint: TOKEN, owner: wallet.toBase58(), uiTokenAmount: { amount: "1000", decimals: 6, uiAmount: 1000 } }];
  (tx.meta as unknown as { postTokenBalances: unknown[] }).postTokenBalances = [];
  const r = buildReport(tx, "sig", opts(treasury));
  assert.equal(r.trade?.side, "sell");
  assert.equal(r.trade?.baseLamports, proceeds);
  assert.equal(r.fee.verdict, "match");
});

test("a fee of 1% on a trade that should pay 0.5% is a mismatch, and says by how much", () => {
  const wallet = k();
  const treasury = k();
  const r = buildReport(buyTx(treasury, wallet, { amount: 50_000_000, fee: 500_000 }), "sig", opts(treasury));
  assert.equal(r.fee.verdict, "mismatch");
  assert.equal(r.fee.diffLamports, 250_000);
});

test("no fee at all: 'no_fee_found' when the treasury could have received it, 'skipped_by_design' when it could not", () => {
  const wallet = k();
  const treasury = k();
  const funded = buildReport(buyTx(treasury, wallet, { amount: 50_000_000, fee: 0, treasuryPre: 2_000_000 }), "sig", opts(treasury));
  assert.equal(funded.fee.verdict, "no_fee_found");
  // treasury never funded: a 250k fee would leave it under the 890,880 rent minimum, so PANDA skips the fee on purpose
  const unfunded = buildReport(buyTx(treasury, wallet, { amount: 50_000_000, fee: 0, treasuryPre: 0 }), "sig", opts(treasury));
  assert.equal(unfunded.fee.verdict, "skipped_by_design");
  assert.match(unfunded.fee.note, /Fund the treasury/);
});

test("a failed transaction and a plain transfer are reported as such, never as a fee problem", () => {
  const wallet = k();
  const treasury = k();
  const failed = buildReport(makeTx({ wallet, err: { InstructionError: [1, "Custom"] }, accounts: [{ key: wallet, signer: true, pre: 10, post: 5 }] }), "sig", opts(treasury));
  assert.equal(failed.status, "failed");
  assert.equal(failed.fee.verdict, "tx_failed");
  const transfer = buildReport(makeTx({ wallet, accounts: [{ key: wallet, signer: true, pre: 1_000_000_000, post: 900_000_000 }, { key: k(), pre: 0, post: 100_000_000 - NETWORK_FEE }] }), "sig", opts(treasury));
  assert.equal(transfer.fee.verdict, "not_a_trade");
});

test("the report lists every account with its own SOL change, labels known programs, and marks the treasury and the wallet", () => {
  const wallet = k();
  const treasury = k();
  const r = buildReport(buyTx(treasury, wallet, { amount: 50_000_000, fee: 250_000 }), "sig", opts(treasury));
  assert.equal(r.accounts.length, 4);
  assert.equal(r.accounts.find((a) => a.pubkey === treasury.toBase58())?.label, "PANDA treasury");
  assert.equal(r.accounts.find((a) => a.pubkey === wallet.toBase58())?.label, "trader wallet");
  assert.ok(r.programs.some((p) => p.label === "PumpSwap (AMM)"));
  assert.ok(r.programs.some((p) => p.label === "Compute Budget"));
});

test("--wallet lets the report be about someone other than the fee payer", () => {
  const wallet = k();
  const treasury = k();
  const tx = buyTx(treasury, wallet, { amount: 50_000_000, fee: 250_000 });
  assert.equal(buildReport(tx, "sig", opts(treasury, wallet)).fee.verdict, "match");
  assert.equal(buildReport(tx, "sig", opts(treasury, k())).fee.verdict, "not_a_trade", "a wallet that isn't in the transaction has no trade in it");
});
