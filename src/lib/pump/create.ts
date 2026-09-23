import { AddressLookupTableAccount, PublicKey, Transaction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
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
 * The creator-fee split (Fee Distribution) is NOT in THIS (legacy) transaction: bundled with create_v2 it never fit — create_v2
 * alone is ~790 bytes and adding `createFeeSharingConfig` + `updateFeeShares` gives 1,238–1,347 bytes against Solana's
 * 1,232-byte limit (measured; even without the compute-limit instruction). There are two ways round that:
 *   - `buildLaunchTransaction` (below): ONE v0 transaction using PANDA's Address Lookup Table (launch-alt.ts) — atomic, preferred;
 *   - the fallback when the table isn't configured or the launch doesn't fit: this transaction, then `buildFeeSharingTransaction`
 *     right after it confirms — see /api/pump/create (`step: "fees"`) and fee-lock.ts, which keeps such a coin out of PANDA's
 *     lists until the split is on-chain.
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

/** Solana's limit for a serialized transaction, signatures included. */
export const MAX_TX_BYTES = 1232;

/**
 * The whole launch in ONE transaction: create_v2 + the fee split, as a v0 message that loads the launch's fixed accounts from
 * PANDA's lookup table (see launch-alt.ts). Atomic: the coin can't exist without its split, and PANDA's locked 5% can't be
 * skipped by rejecting a second signature. The creator and the mint both sign it (the client adds the mint's signature).
 *
 * Returns null when it doesn't fit 1,232 bytes — the caller then falls back to the two-transaction path rather than
 * sending something the network would reject.
 */
export async function buildLaunchTransaction({
  mint,
  user,
  name,
  symbol,
  uri,
  shareholders,
  lookupTable,
  blockhash,
}: {
  mint: PublicKey;
  user: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  shareholders: FeeShareholderInput[];
  lookupTable: AddressLookupTableAccount;
  blockhash: string;
}): Promise<VersionedTransaction | null> {
  const create = await getPumpSdk().createV2Instruction({ mint, name, symbol, uri, creator: user, user, mayhemMode: false });
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      create,
      ...(await buildFeeSharingInstructions({ mint, creator: user, shareholders })),
    ],
  }).compileToV0Message([lookupTable]);
  const tx = new VersionedTransaction(message);
  try {
    return tx.serialize().length <= MAX_TX_BYTES ? tx : null;
  } catch {
    return null; // web3.js throws when the message can't even be encoded in 1,232 bytes
  }
}
