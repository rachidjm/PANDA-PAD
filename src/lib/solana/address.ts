import { PublicKey } from "@solana/web3.js";

/**
 * The Solana address (a mint, a wallet…) in what a person pasted, or null. Tolerates surrounding spaces/newlines and a `solana:` prefix;
 * anything that isn't exactly one valid 32-byte base58 address is null — a ticker, a name, half an address.
 */
export function addressFromInput(raw: string): string | null {
  const s = raw.trim().replace(/^solana:/i, "");
  if (s.length < 32 || s.length > 44 || /[^1-9A-HJ-NP-Za-km-z]/.test(s)) return null;
  try {
    const key = new PublicKey(s);
    return key.toBase58() === s ? s : null;
  } catch {
    return null;
  }
}
