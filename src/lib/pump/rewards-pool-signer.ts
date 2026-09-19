import { Keypair } from "@solana/web3.js";

/**
 * Loads the Rewards Pool's real signing key from a server-only env var —
 * never a `NEXT_PUBLIC_*` variable, never in this repo, never something a
 * client request can read. Used only by the collect-fees cron (to pay the
 * fee for triggering a real on-chain distribution) and the claim route (to
 * sign a real payout to a holder).
 *
 * Expects the exact JSON-array format `solana-keygen new` (or "Export
 * private key" in most wallets) produces — e.g. `[12,34,56,...]` — pasted
 * directly into Vercel's Environment Variables dashboard as
 * PANDA_REWARDS_POOL_SECRET_KEY. Returns `null` when unset, so callers can
 * fail with an honest "not configured" error instead of crashing.
 */
export function getRewardsPoolSigner(): Keypair | null {
  const raw = process.env.PANDA_REWARDS_POOL_SECRET_KEY;
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error(
      "PANDA_REWARDS_POOL_SECRET_KEY is set but isn't valid — expected a JSON array like the one solana-keygen or your wallet's key export produces."
    );
  }
}
