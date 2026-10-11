import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { isEnabled } from "@/lib/config/flags";

/**
 * Burn (FEATURE_BURN): a coin's "Burn" share of its creator fees is paid to PANDA's burn wallet, which buys that same
 * coin and burns what it bought with the token program's own burn instruction — the tokens stop existing; they are
 * not sent to some address. This file is its settings and its signer; ./run.ts does the work.
 */

type Env = Record<string, string | undefined>;

const LAMPORTS = 1_000_000_000;
export const DEFAULT_BURN_MIN_SOL = 0.05;
/** Kept back from every buy for the network fees and the token account's rent (returned when the account is closed after burning). */
export const BURN_RESERVE_LAMPORTS = 5_000_000;

/** A coin is bought and burned once its Burn share has gathered this much (BURN_MIN_SOL, default 0.05; never under 0.01: below that fees eat it). */
export function burnMinLamports(env: Env = process.env): number {
  const n = Number(env.BURN_MIN_SOL);
  const sol = Number.isFinite(n) && n > 0 ? Math.max(0.01, Math.min(n, 100)) : DEFAULT_BURN_MIN_SOL;
  return Math.round(sol * LAMPORTS);
}

/** How much of a coin's pending Burn SOL to spend now: all of it but the reserve — or nothing while it is under the minimum. */
export function burnSpendLamports(pendingLamports: number, minLamports: number): number {
  if (!Number.isSafeInteger(pendingLamports) || pendingLamports < minLamports) return 0;
  return Math.max(0, pendingLamports - BURN_RESERVE_LAMPORTS);
}

export function burnWalletAddress(env: Env = process.env): string | null {
  const v = env.NEXT_PUBLIC_PANDA_BURN_WALLET?.trim();
  if (!v) return null;
  try {
    return new PublicKey(v).toBase58();
  } catch {
    return null;
  }
}

/** On with the flag AND a burn wallet to pay: without the wallet there is nothing a split could point at. */
export const burnEnabled = (env: Env = process.env) => isEnabled("BURN", env) && burnWalletAddress(env) !== null;

const looksLikeMnemonic = (raw: string) => {
  const words = raw.split(/\s+/).filter(Boolean);
  return (words.length === 12 || words.length === 24) && words.every((w) => /^[a-zA-Z]+$/.test(w));
};

/**
 * The burn wallet's signing key, from the server-only PANDA_BURN_WALLET_SECRET_KEY (a base58 string or a JSON byte
 * array — never a recovery phrase, which is refused). Null when unset. It MUST match NEXT_PUBLIC_PANDA_BURN_WALLET:
 * a key for any other wallet throws, so nothing is ever bought or burned from a wallet that isn't the one coins pay.
 * The error names the variable and the public addresses only — never the key.
 */
export function getBurnSigner(env: Env = process.env): Keypair | null {
  const raw = env.PANDA_BURN_WALLET_SECRET_KEY?.trim();
  if (!raw) return null;
  if (looksLikeMnemonic(raw)) throw new Error("PANDA_BURN_WALLET_SECRET_KEY looks like a recovery phrase, not a private key — refusing to use it. It must be the exported secret key of a dedicated wallet.");
  let keypair: Keypair;
  try {
    keypair = raw.startsWith("[") ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    throw new Error("PANDA_BURN_WALLET_SECRET_KEY is set but isn't a valid secret key (a base58 string or a JSON byte array).");
  }
  const expected = burnWalletAddress(env);
  if (!expected) throw new Error("PANDA_BURN_WALLET_SECRET_KEY is set but NEXT_PUBLIC_PANDA_BURN_WALLET isn't: the burn wallet's public address must be configured too.");
  if (keypair.publicKey.toBase58() !== expected) throw new Error(`PANDA_BURN_WALLET_SECRET_KEY doesn't match NEXT_PUBLIC_PANDA_BURN_WALLET (${expected}): it resolves to ${keypair.publicKey.toBase58()}. Nothing is bought or burned until they match.`);
  return keypair;
}
