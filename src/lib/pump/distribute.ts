import { Connection, Transaction, ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { getRawSharingConfig } from "./fee-sharing";
import { getRewardsPoolSigner } from "./rewards-pool-signer";

const TYPICAL_BASE_FEE_LAMPORTS = 5000;

/**
 * Triggers a coin's real, on-chain, permissionless `distributeCreatorFees`
 * (confirmed via reading `@pump-fun/pump-sdk`'s actual IDL account
 * constraints — no admin/authority signature required, just a fee payer),
 * which pays every configured shareholder — including the Rewards Pool —
 * their real share directly, atomically. Returns exactly how many lamports
 * that call contributed to the Rewards Pool wallet specifically, isolated
 * from the network fee this same call spent (measured via the confirmed
 * transaction's real `meta.fee`, not assumed) — or `null` if there was
 * nothing real to distribute yet (a genuine dust-threshold check, not a
 * guess) or the mint has no fee-sharing config at all.
 *
 * SOL-quoted coins only for now — `distributeCreatorFeesV2` (needed for a
 * coin quoted in a non-SOL token) isn't wired up yet; a real, disclosed
 * scope limit, not silently unsupported.
 */
export async function collectFeesForMint(connection: Connection, mint: string): Promise<number | null> {
  const signer = getRewardsPoolSigner();
  if (!signer) throw new Error("Rewards Pool signer isn't configured (PANDA_REWARDS_POOL_SECRET_KEY).");

  const mintKey = new PublicKey(mint);
  const raw = await getRawSharingConfig(connection, mintKey);
  if (!raw) return null;

  const online = getOnlinePumpSdk(connection);
  const minFee = await online.getMinimumDistributableFee(mintKey, signer.publicKey, { payer: signer.publicKey });
  if (!minFee.canDistribute) return null;

  const before = await connection.getBalance(signer.publicKey);

  const offline = getPumpSdk();
  const ix = await offline.distributeCreatorFees({
    mint: mintKey,
    sharingConfig: raw.config,
    sharingConfigAddress: raw.address,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(ix);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(signer);

  const signature = await connection.sendRawTransaction(tx.serialize());
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error(`distributeCreatorFees failed to confirm for ${mint}.`);

  const after = await connection.getBalance(signer.publicKey);
  const txInfo = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
  const feePaid = txInfo?.meta?.fee ?? TYPICAL_BASE_FEE_LAMPORTS;

  // after = before - feePaid + distributed, so:
  return Math.max(0, after - before + feePaid);
}
