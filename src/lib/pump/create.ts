import { PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getPumpSdk } from "./client";
import { buildFeeSharingInstructions } from "./fee-sharing";
import { FeeShareholderInput } from "./fee-shares-validation";

/**
 * Builds a real, unsigned Pump.fun create_v2 transaction (no initial buy —
 * PANDA's create form doesn't offer a dev-buy amount yet). Server-side only:
 * `@pump-fun/pump-sdk` isn't browser-bundle friendly, so this never runs in
 * the client — see /api/pump/create, which the client calls instead.
 *
 * `mint` is generated client-side (Keypair.generate()) and only its public
 * key is sent here; the client keeps the secret key in memory to co-sign
 * the transaction itself once this comes back.
 *
 * When `shareholders` is given, Fee Distribution's on-chain setup
 * (`createFeeSharingConfig` + `updateFeeShares`, see `./fee-sharing.ts`) is
 * bundled into this SAME transaction, right after the create instruction —
 * the create instruction initializes the mint earlier in the same
 * transaction, and later instructions in one transaction see that write, so
 * the fee-sharing config can reference the mint immediately without waiting
 * for a separate confirmed transaction first. This means Fee Distribution is
 * decided once, before the creator signs anything — not as an extra step
 * after the coin already exists.
 */
export async function buildCreateTransaction({
  mint,
  user,
  name,
  symbol,
  uri,
  shareholders,
}: {
  mint: PublicKey;
  user: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  shareholders?: FeeShareholderInput[];
}): Promise<Transaction> {
  const offline = getPumpSdk();

  const instruction = await offline.createV2Instruction({
    mint,
    name,
    symbol,
    uri,
    creator: user,
    user,
    mayhemMode: false,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: shareholders?.length ? 400_000 : 200_000 }));
  tx.add(instruction);

  if (shareholders && shareholders.length > 0) {
    const feeIxs = await buildFeeSharingInstructions({ mint, creator: user, shareholders });
    tx.add(...feeIxs);
  }

  return tx;
}
