import { PublicKey } from "@solana/web3.js";
import { CREATOR_CONFIGURABLE_MAX_BPS, PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { PANDA_TREASURY } from "./constants";

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
    if (!s || typeof s.address !== "string") return "Malformed recipient.";
    if (!Number.isSafeInteger(s.shareBps) || s.shareBps <= 0 || s.shareBps > TOTAL_SHARE_BPS) {
      return "Every allocation must be a positive percentage.";
    }
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

  // PANDA's share is locked: it must be present, pay the treasury, and be exactly PANDA_SHARE_BPS.
  // Enforced here (server-side too) — the UI pre-filling it is a convenience, not the guarantee.
  const treasury = PANDA_TREASURY.toBase58();
  const pandaEntries = shareholders.filter((s) => new PublicKey(s.address).toBase58() === treasury);
  if (pandaEntries.length !== 1 || pandaEntries[0].shareBps !== PANDA_SHARE_BPS) {
    return `PANDA Protocol's ${PANDA_SHARE_BPS / 100}% share is locked and can't be removed or changed.`;
  }
  const creatorSide = total - PANDA_SHARE_BPS;
  if (creatorSide > CREATOR_CONFIGURABLE_MAX_BPS) return "Creator allocations can't exceed 95%.";
  return null;
}
