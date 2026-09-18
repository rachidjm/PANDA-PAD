import { PublicKey } from "@solana/web3.js";

/** Client-safe (no `@pump-fun/pump-sdk` import) — usable from `FeeDistributionStep`, the API route, and `fee-sharing.ts` alike. */
export type FeeShareholderInput = { address: string; shareBps: number };

export const MAX_SHAREHOLDERS = 10;
export const TOTAL_SHARE_BPS = 10_000;

/**
 * Validates a shareholder list exactly the way the on-chain program will
 * (see `updateFeeShares`'s requirements in `@pump-fun/pump-sdk`) — used both
 * client-side, for instant feedback, and server-side in
 * `/api/pump/fee-shares`, which never trusts the client-only check alone.
 */
export function validateShareholders(shareholders: FeeShareholderInput[]): string | null {
  if (shareholders.length === 0) return "Add at least one recipient.";
  if (shareholders.length > MAX_SHAREHOLDERS) return `A coin can have at most ${MAX_SHAREHOLDERS} fee recipients.`;

  const seen = new Set<string>();
  for (const s of shareholders) {
    if (!Number.isInteger(s.shareBps) || s.shareBps <= 0) return "Every allocation must be a positive percentage.";
    let address: PublicKey;
    try {
      address = new PublicKey(s.address);
    } catch {
      return `"${s.address}" isn't a valid Solana wallet address.`;
    }
    const key = address.toBase58();
    if (seen.has(key)) return "Each recipient can only appear once.";
    seen.add(key);
  }

  const total = shareholders.reduce((sum, s) => sum + s.shareBps, 0);
  if (total !== TOTAL_SHARE_BPS) return `Allocations must total exactly 100% (currently ${(total / 100).toFixed(2)}%).`;
  return null;
}
