import type { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { confirmSignature } from "@/lib/solana/confirm";
import { base64ToTransaction } from "./wire";

/**
 * Browser side of setting a coin's on-chain fee split (PANDA's locked 5% + the creator's allocations) as its own transaction:
 * used right after a two-transaction launch (Create) and later from the coin page if the creator hadn't finished it.
 * The server refuses to build it for a split without PANDA's share and for a coin that doesn't exist yet.
 */
export async function applyFeeSplit({
  connection,
  publicKey,
  sendTransaction,
  mint,
  shareholders,
  errors,
}: {
  connection: Connection;
  publicKey: PublicKey | null;
  sendTransaction: WalletContextState["sendTransaction"];
  mint: string;
  shareholders: { address: string; shareBps: number }[];
  errors: { noWallet: string; build: string };
}): Promise<void> {
  if (!publicKey) throw new Error(errors.noWallet);
  let data: { transaction?: string; error?: string; code?: string } = {};
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("/api/pump/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "fees", mint, user: publicKey.toBase58(), shareholders }),
    });
    data = await res.json();
    if (res.ok) break;
    // Right after the create confirms, the RPC node may not have the new coin yet: wait a moment and ask again.
    if (data.code === "MINT_NOT_FOUND" && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(data.error || errors.build);
  }
  const tx = base64ToTransaction(data.transaction as string);
  const signature = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });
  await confirmSignature(connection, signature);
  await registerFeeDistribution(mint);
}

/** Best-effort — the split is already on-chain; this adds the mint to PANDA's registry of coins whose fees the distributor collects, and lets the fee-lock registry catch up. */
export function registerFeeDistribution(mint: string): Promise<void> {
  return fetch("/api/pump/register-fee-distribution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mint }),
  })
    .then(() => undefined)
    .catch(() => undefined);
}
