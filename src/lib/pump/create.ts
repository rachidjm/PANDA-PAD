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
 * The creator-fee split (Fee Distribution) is NOT in this transaction. Bundled with the create instruction it never fit: the
 * Pump SDK's create_v2 alone is ~790 bytes, and adding `createFeeSharingConfig` + `updateFeeShares` gives 1,238–1,347 bytes
 * against Solana's 1,232-byte limit (measured; even with the compute-limit instruction removed). So the split is a second
 * transaction, `buildFeeSharingTransaction`, sent right after this one confirms — see /api/pump/create (`step: "fees"`).
 */
export async function buildCreateTransaction({
  mint,
  user,
  name,
  symbol,
  uri,
}: {
  mint: PublicKey;
  user: PublicKey;
  name: string;
  symbol: string;
  uri: string;
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
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(instruction);
  return tx;
}

/**
 * The second transaction of a launch with a fee split: creates the coin's on-chain SharingConfig and writes the shareholders
 * (PANDA's locked 5% among them — validated by the route). The creator signs it; it only makes sense once the coin exists.
 */
export async function buildFeeSharingTransaction({ mint, user, shareholders }: { mint: PublicKey; user: PublicKey; shareholders: FeeShareholderInput[] }): Promise<Transaction> {
  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(...(await buildFeeSharingInstructions({ mint, creator: user, shareholders })));
  return tx;
}
