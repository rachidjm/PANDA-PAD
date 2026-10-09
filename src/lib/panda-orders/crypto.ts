import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * At-rest encryption of the user-signed PANDA order transactions (server-only). AES-256-GCM, Node's own `crypto`.
 * `PANDA_ORDERS_KEY` is 32 random bytes, base64 — its OWN key, separate from VANITY_STOCK_KEY / RESERVED_MINT_KEY, so a
 * leak of one never exposes another. A signed order can't be altered by whoever holds it (any change breaks the user's
 * signature), but it can be SENT: that's why it is encrypted — whoever reads the database without this key can't
 * submit anybody's sale. Each row is bound to its order id (GCM additional data), so a ciphertext can't be swapped
 * onto another order.
 */

function keyFromEnv(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.PANDA_ORDERS_KEY?.trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

export function hasOrdersKey(env: Record<string, string | undefined> = process.env): boolean {
  return keyFromEnv(env) !== null;
}

export type SealedTx = { ciphertext: string; iv: string };

/** null only when PANDA_ORDERS_KEY is missing or malformed. */
export function sealTx(orderId: string, tx: Uint8Array, env: Record<string, string | undefined> = process.env): SealedTx | null {
  const key = keyFromEnv(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(orderId, "utf8"));
  const enc = Buffer.concat([cipher.update(Buffer.from(tx)), cipher.final()]);
  return { ciphertext: Buffer.concat([enc, cipher.getAuthTag()]).toString("base64"), iv: iv.toString("base64") };
}

/** null when the key is missing/wrong, or the row was tampered with / moved to another order — never throws. */
export function openTx(orderId: string, sealed: SealedTx, env: Record<string, string | undefined> = process.env): Uint8Array | null {
  const key = keyFromEnv(env);
  if (!key) return null;
  try {
    const data = Buffer.from(sealed.ciphertext, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(orderId, "utf8"));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return new Uint8Array(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]));
  } catch {
    return null;
  }
}
