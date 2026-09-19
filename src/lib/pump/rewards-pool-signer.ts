import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Loads the Rewards Pool's real signing key from a server-only env var —
 * never a `NEXT_PUBLIC_*` variable, never in this repo, never something a
 * client request can read. Used only by the collect-fees cron (to pay the
 * fee for triggering a real on-chain distribution) and the claim route (to
 * sign a real payout to a holder).
 *
 * Accepts either format a Solana wallet might hand you when exporting a
 * private key: a base58 string (Phantom/Solflare's "Export Private Key",
 * the more common case) or a JSON array like `solana-keygen new` produces
 * (e.g. `[12,34,56,...]`) — pasted directly into Vercel's Environment
 * Variables dashboard as PANDA_REWARDS_POOL_SECRET_KEY. Returns `null` when
 * unset, so callers can fail with an honest "not configured" error instead
 * of crashing.
 */
export function getRewardsPoolSigner(): Keypair | null {
  const raw = process.env.PANDA_REWARDS_POOL_SECRET_KEY?.trim();
  if (!raw) return null;

  try {
    if (raw.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    throw new Error(
      "PANDA_REWARDS_POOL_SECRET_KEY is set but isn't valid — expected either a base58 string (from Phantom/Solflare's key export) or a JSON array (from solana-keygen)."
    );
  }
}
