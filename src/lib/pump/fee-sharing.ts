import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { getPumpSdk } from "./client";
import { FeeShareholderInput } from "./fee-shares-validation";

/**
 * Builds a real, unsigned transaction that opts a freshly-created coin into
 * Pump.fun's on-chain creator-fee sharing (`@pump-fun/pump-sdk`'s
 * `createFeeSharingConfig` + `updateFeeShares` against the real `SharingConfig`
 * PDA for this mint — not a PANDA-invented mechanism). Server-side only, same
 * shape as `buildCreateTransaction` in `./create.ts`.
 *
 * Only usable right after a coin is created (before any sharing config
 * exists for it), since `currentShareholders` is sent empty here — updating
 * an existing config's shareholders later needs the real current list, which
 * this module doesn't attempt yet.
 */
export async function buildFeeSharingTransaction({
  mint,
  creator,
  shareholders,
}: {
  mint: PublicKey;
  creator: PublicKey;
  shareholders: FeeShareholderInput[];
}): Promise<Transaction> {
  const offline = getPumpSdk();

  const createConfigIx = await offline.createFeeSharingConfig({ creator, mint, pool: null });
  const updateSharesIx = await offline.updateFeeShares({
    authority: creator,
    mint,
    currentShareholders: [],
    newShareholders: shareholders.map((s) => ({ address: new PublicKey(s.address), shareBps: s.shareBps })),
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(createConfigIx, updateSharesIx);
  return tx;
}

/** Reads a coin's real on-chain Fee Distribution back from its `SharingConfig` PDA — `null` if it never opted in. */
export async function getFeeSharingConfig(
  connection: Connection,
  mint: PublicKey
): Promise<{ address: string; shareBps: number }[] | null> {
  const pda = feeSharingConfigPda(mint);
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) return null;
  const offline = getPumpSdk();
  const config = offline.decodeSharingConfig(accountInfo);
  return config.shareholders.map((s) => ({ address: s.address.toBase58(), shareBps: s.shareBps }));
}
