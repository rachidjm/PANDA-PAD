import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for one-off reserved mint keypairs (server-only). AES-256-GCM, Node's own `crypto` — no
 * new dependency, same scheme as src/lib/vanity/crypto.ts. `RESERVED_MINT_KEY` is its OWN 32 random bytes,
 * base64-encoded, set once in Vercel and never elsewhere — deliberately a DIFFERENT key than VANITY_STOCK_KEY
 * (same discipline as PANDA_REWARDS_POOL_SECRET_KEY) so a leak of the shared vanity stock's key can never
 * expose a reserved key, and vice versa. Losing it makes a reserved row unreadable forever — there is no
 * fallback for a specific reserved address the way the generic stock falls back to a random keypair.
 */

function keyFromEnv(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.RESERVED_MINT_KEY?.trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function hasReservedMintKey(env: Record<string, string | undefined> = process.env): boolean {
  return keyFromEnv(env) !== null;
}

export type Encrypted = { ciphertext: string; nonce: string };

/** null only when RESERVED_MINT_KEY is missing or malformed. */
export function encryptSecretKey(secretKey: Uint8Array, env: Record<string, string | undefined> = process.env): Encrypted | null {
  const key = keyFromEnv(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  return { ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString("base64"), nonce: iv.toString("base64") };
}

/** null when the key is missing/malformed OR the ciphertext doesn't verify (tampered, wrong key, corrupt row) — never throws. */
export function decryptSecretKey(stored: Encrypted, env: Record<string, string | undefined> = process.env): Uint8Array | null {
  const key = keyFromEnv(env);
  if (!key) return null;
  try {
    const iv = Buffer.from(stored.nonce, "base64");
    const data = Buffer.from(stored.ciphertext, "base64");
    const tag = data.subarray(data.length - 16);
    const enc = data.subarray(0, data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(enc), decipher.final()]));
  } catch {
    return null;
  }
}
