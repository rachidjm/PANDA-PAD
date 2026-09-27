import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption for the vanity keypair stock (server-only). AES-256-GCM, Node's own `crypto` — no new
 * dependency. `VANITY_STOCK_KEY` is 32 random bytes, base64-encoded, set once in Vercel and never elsewhere
 * (same discipline as PANDA_REWARDS_POOL_SECRET_KEY): losing it makes the whole stock unreadable (a fresh key
 * generates fine, it just isn't a vanity address any more — see src/lib/vanity/stock.ts's fallback), and
 * anyone who has it can decrypt every row, so it is exactly as sensitive as a private key itself.
 */

function keyFromEnv(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.VANITY_STOCK_KEY?.trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function hasVanityStockKey(env: Record<string, string | undefined> = process.env): boolean {
  return keyFromEnv(env) !== null;
}

export type Encrypted = { ciphertext: string; nonce: string };

/** null only when VANITY_STOCK_KEY is missing or malformed. */
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
