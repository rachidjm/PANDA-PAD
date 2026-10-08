import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * A 12 or 24-word BIP39 recovery phrase, not a private key — pasting one here would let the server re-derive
 * someone's ENTIRE wallet (every account, on every chain it supports), not just hand it a single dedicated
 * key. Checked by shape only (word count + alphabetic tokens): a real exported secret key is base58 (mixed
 * case and digits) or a JSON byte array, never space-separated lowercase words.
 */
function looksLikeMnemonic(raw: string): boolean {
  const words = raw.split(/\s+/).filter(Boolean);
  return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-zA-Z]+$/.test(w));
}

function parseSecretKey(raw: string): Keypair {
  if (looksLikeMnemonic(raw)) {
    throw new Error(
      "PANDA_REWARDS_POOL_SECRET_KEY looks like a 12/24-word recovery phrase, not a private key — refusing to derive a wallet from it. " +
        "A recovery phrase controls an entire wallet (every account it has, on every chain); this variable must hold the EXPORTED SECRET KEY " +
        "of a dedicated server wallet instead (base58 string, or a JSON byte array like `solana-keygen new` produces)."
    );
  }
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

function expectedPublicKey(): PublicKey | null {
  const v = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL?.trim();
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null; // reported as "invalid" by src/lib/config/env.ts already; not this function's job to fail for it
  }
}

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
 *
 * Refuses a recovery phrase outright (see `looksLikeMnemonic`), and — when
 * NEXT_PUBLIC_PANDA_REWARDS_POOL is also set — refuses to hand back a signer
 * whose derived public key doesn't match it: if the two are ever out of
 * sync (the secret swapped for the wrong wallet, or the public one edited
 * without the secret), every caller that would move real money through this
 * signer throws instead of silently paying out of a stranger's wallet.
 */
export function getRewardsPoolSigner(): Keypair | null {
  const raw = process.env.PANDA_REWARDS_POOL_SECRET_KEY?.trim();
  if (!raw) return null;

  const keypair = parseSecretKey(raw);
  const expected = expectedPublicKey();
  if (expected && !keypair.publicKey.equals(expected)) {
    throw new Error(
      `PANDA_REWARDS_POOL_SECRET_KEY doesn't match NEXT_PUBLIC_PANDA_REWARDS_POOL. Configured public key: ${expected.toBase58()}. ` +
        `The secret actually loaded resolves to: ${keypair.publicKey.toBase58()}. Fix one of the two in Vercel — nothing moves money through ` +
        `this signer until they match.`
    );
  }
  return keypair;
}

export type RewardsPoolServerStatus =
  | { configured: false }
  | { configured: true; ok: true; publicKey: string }
  | { configured: true; ok: false; error: string };

/**
 * Same load `getRewardsPoolSigner` does, but never throws — for anything that just wants to REPORT what the
 * server is actually able to load right now (the /admin panel), never the secret itself, never a signer to use.
 */
export function rewardsPoolServerStatus(): RewardsPoolServerStatus {
  const raw = process.env.PANDA_REWARDS_POOL_SECRET_KEY?.trim();
  if (!raw) return { configured: false };
  try {
    const keypair = getRewardsPoolSigner();
    if (!keypair) return { configured: false };
    return { configured: true, ok: true, publicKey: keypair.publicKey.toBase58() };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : "Invalid." };
  }
}
