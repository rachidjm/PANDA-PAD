import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, anchorMemo, anchorTxMatches, buildAnchorTx, parseAnchorMemo } from "./anchor";

const HASH = "ab".repeat(32);
const wallet = Keypair.generate().publicKey;

const tx = (over: Record<string, unknown> = {}) => ({
  meta: { err: null },
  transaction: {
    message: {
      accountKeys: [{ pubkey: wallet.toBase58(), signer: true }, { pubkey: MEMO_PROGRAM_ID.toBase58(), signer: false }],
      instructions: [{ programId: MEMO_PROGRAM_ID.toBase58(), parsed: anchorMemo(7, HASH) }],
    },
  },
  ...over,
});

test("the memo names the head, and parsing it back is exact (anything else is rejected)", () => {
  assert.equal(anchorMemo(7, HASH), `PANDA-AUDIT v1 seq=7 head=${HASH}`);
  assert.deepEqual(parseAnchorMemo(anchorMemo(7, HASH)), { seq: 7, hash: HASH });
  assert.equal(parseAnchorMemo("PANDA-AUDIT v1 seq=7 head=zz"), null);
  assert.equal(parseAnchorMemo(`hello ${anchorMemo(7, HASH)}`), null);
});

test("the anchor transaction is one Memo instruction signed by the admin's wallet, carrying exactly that text", () => {
  const t = buildAnchorTx(wallet, 7, HASH);
  assert.equal(t.instructions.length, 1);
  assert.ok(t.instructions[0].programId.equals(MEMO_PROGRAM_ID));
  assert.ok(t.instructions[0].keys[0].pubkey.equals(wallet) && t.instructions[0].keys[0].isSigner);
  assert.equal(Buffer.from(t.instructions[0].data).toString("utf8"), anchorMemo(7, HASH));
});

test("a transaction is accepted as an anchor ONLY if confirmed OK, signed by that admin, with exactly that memo", () => {
  assert.equal(anchorTxMatches(tx() as never, wallet.toBase58(), 7, HASH), true);
  assert.equal(anchorTxMatches(null, wallet.toBase58(), 7, HASH), false, "not found");
  assert.equal(anchorTxMatches(tx({ meta: { err: { InstructionError: [0, "x"] } } }) as never, wallet.toBase58(), 7, HASH), false, "failed on-chain");
  assert.equal(anchorTxMatches(tx() as never, Keypair.generate().publicKey.toBase58(), 7, HASH), false, "signed by someone else");
  assert.equal(anchorTxMatches(tx() as never, wallet.toBase58(), 8, HASH), false, "a different head");
  assert.equal(anchorTxMatches(tx() as never, wallet.toBase58(), 7, "cd".repeat(32)), false, "a different hash");
  const wrongProgram = tx();
  wrongProgram.transaction.message.instructions[0].programId = Keypair.generate().publicKey.toBase58();
  assert.equal(anchorTxMatches(wrongProgram as never, wallet.toBase58(), 7, HASH), false, "the text must come from the Memo program");
});
