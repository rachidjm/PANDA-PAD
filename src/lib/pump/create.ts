import { PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getPumpSdk } from "./client";

/**
 * Builds a real, unsigned Pump.fun create_v2 transaction (no initial buy —
 * PANDA's create form doesn't offer a dev-buy amount yet). Server-side only:
 * `@pump-fun/pump-sdk` isn't browser-bundle friendly, so this never runs in
 * the client — see /api/pump/create, which the client calls instead.
 *
 * `mint` is generated client-side (Keypair.generate()) and only its public
 * key is sent here; the client keeps the secret key in memory to co-sign
 * the transaction itself once this comes back.
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
