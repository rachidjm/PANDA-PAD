import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { tokenProgramForOwner } from "./token-program";
import { feeIsReceivable, MIN_SYSTEM_ACCOUNT_LAMPORTS } from "./fee-transfer";

test("the token program of a coin comes from the account that owns its mint: Token-2022 (Pump.fun's coins now) or classic", () => {
  assert.equal(tokenProgramForOwner("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")?.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(tokenProgramForOwner("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")?.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(tokenProgramForOwner(TOKEN_2022_PROGRAM_ID)?.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(tokenProgramForOwner("11111111111111111111111111111111"), null, "a system account is not a token mint");
  assert.equal(tokenProgramForOwner(new PublicKey(Buffer.alloc(32, 5))), null);
});

test("a fee is only added when the treasury can receive it (an unfunded wallet can't take less than the rent minimum)", () => {
  // The reported situation: an unfunded treasury and a small trade. 0.05 SOL at 0.5% = 250,000 lamports < 890,880.
  assert.equal(feeIsReceivable(250_000, 0), false);
  assert.equal(feeIsReceivable(MIN_SYSTEM_ACCOUNT_LAMPORTS, 0), true, "a fee that reaches the minimum on its own is fine");
  assert.equal(feeIsReceivable(1, MIN_SYSTEM_ACCOUNT_LAMPORTS), true, "a funded treasury takes any amount");
  assert.equal(feeIsReceivable(250_000, 700_000), true, "existing balance + fee reaches the minimum");
  assert.equal(feeIsReceivable(0, 5_000_000), false, "nothing to charge");
  assert.equal(feeIsReceivable(BigInt("250000"), 0), false, "bigint amounts too");
});
