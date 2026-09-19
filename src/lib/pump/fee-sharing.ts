import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { getPumpSdk } from "./client";
import { FeeShareholderInput } from "./fee-shares-validation";

/**
 * Builds the real instructions that opt a coin into Pump.fun's on-chain
 * creator-fee sharing (`@pump-fun/pump-sdk`'s `createFeeSharingConfig` +
 * `updateFeeShares` against the real `SharingConfig` PDA for this mint — not
 * a PANDA-invented mechanism). Returns raw instructions, not a full
 * transaction, so `create.ts` can bundle them into the same transaction as
 * the coin's own creation — a brand-new mint is initialized by the create
 * instruction earlier in that same transaction, and Solana instructions in
 * one transaction see each other's writes, so this doesn't need the mint to
 * exist as a separate, already-confirmed transaction first.
 *
 * Only usable for a coin's first-ever fee-sharing setup, since
 * `currentShareholders` is sent empty here — updating an existing config's
 * shareholders later needs the real current list, which this module doesn't
 * attempt yet.
 */
export async function buildFeeSharingInstructions({
  mint,
  creator,
  shareholders,
}: {
  mint: PublicKey;
  creator: PublicKey;
  shareholders: FeeShareholderInput[];
}): Promise<TransactionInstruction[]> {
  const offline = getPumpSdk();

  const createConfigIx = await offline.createFeeSharingConfig({ creator, mint, pool: null });
  const updateSharesIx = await offline.updateFeeShares({
    authority: creator,
    mint,
    currentShareholders: [],
    newShareholders: shareholders.map((s) => ({ address: new PublicKey(s.address), shareBps: s.shareBps })),
  });

  return [createConfigIx, updateSharesIx];
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
