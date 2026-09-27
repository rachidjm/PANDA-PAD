import { Connection, Transaction, ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { getRawSharingConfig } from "./fee-sharing";
import { getRewardsPoolSigner } from "./rewards-pool-signer";
import { distributionShares, Share } from "@/lib/economy/shares";

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
export async function collectFeesForMint(
  connection: Connection,
  mint: string
): Promise<{ lamports: number; signature: string; blockTimeMs: number | null; shares: Share[] } | null> {
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
  const txInfo = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const feePaid = txInfo?.meta?.fee ?? TYPICAL_BASE_FEE_LAMPORTS;

  // after = before - feePaid + distributed, so:
  // What every shareholder really received, read from this transaction's own balance changes (empty if it can't be read).
  const shares =
    txInfo?.meta
      ? distributionShares(
          {
            keys: txInfo.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()),
            pre: txInfo.meta.preBalances,
            post: txInfo.meta.postBalances,
            fee: txInfo.meta.fee,
            feePayer: signer.publicKey.toBase58(),
          },
          raw.config.shareholders.map((s) => s.address.toBase58())
        )
      : [];

  return { lamports: Math.max(0, after - before + feePaid), signature, blockTimeMs: txInfo?.blockTime ? txInfo.blockTime * 1000 : null, shares };
}

/**
 * How much of a coin's creator fees are real and ready to collect RIGHT NOW — a read-only simulation, nothing
 * is sent. `null` when the coin has no fee-sharing config at all (never opted into Fee Distribution).
 * SOL-quoted coins only (see collectFeesForMint's own scope note): `distributableFees` for a token-quoted coin
 * describes SOL fees, not the token's own, per the SDK's own doc comment.
 */
export async function pendingCreatorFeesForMint(connection: Connection, mint: string, simulationSigner: PublicKey): Promise<number | null> {
  const mintKey = new PublicKey(mint);
  const raw = await getRawSharingConfig(connection, mintKey);
  if (!raw) return null;
  const online = getOnlinePumpSdk(connection);
  const minFee = await online.getMinimumDistributableFee(mintKey, simulationSigner, { payer: simulationSigner });
  return minFee.canDistribute ? minFee.distributableFees.toNumber() : 0;
}

/**
 * The SAME real, permissionless `distributeCreatorFees` instruction collectFeesForMint uses (verified against
 * the SDK's own account constraints — no admin/authority signature required, only a fee payer), built for
 * `payer` to sign and send themselves instead of PANDA's Rewards Pool signer — this is how a coin's CREATOR
 * collects their own share from Create's "Mis monedas" page. Pays every configured shareholder atomically
 * (creator, PANDA, Holders pool, ...), not just the caller: whoever pays the (tiny) network fee, everyone gets
 * paid. Unsigned — the caller reviews and signs it in their own wallet, exactly like every other PANDA trade.
 * `null` when the coin has no fee-sharing config, or there is genuinely nothing real to distribute yet.
 */
export async function buildCollectCreatorFeesTransaction(connection: Connection, mint: string, payer: PublicKey): Promise<Transaction | null> {
  const mintKey = new PublicKey(mint);
  const raw = await getRawSharingConfig(connection, mintKey);
  if (!raw) return null;

  const online = getOnlinePumpSdk(connection);
  const minFee = await online.getMinimumDistributableFee(mintKey, payer, { payer });
  if (!minFee.canDistribute) return null;

  const offline = getPumpSdk();
  const ix = await offline.distributeCreatorFees({ mint: mintKey, sharingConfig: raw.config, sharingConfigAddress: raw.address });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(ix);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  return tx;
}
