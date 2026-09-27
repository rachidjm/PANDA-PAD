import { heliusApiKeyFromRpcUrl } from "@/lib/solana/helius";
import { serverRpcUrl } from "@/lib/solana/rpc";

/**
 * "A wallet doesn't count as referred if its first SOL came from the wallet that invited it" — the obvious
 * self-referral move (fund a second wallet from your own, use it to 'refer' yourself). Checked against
 * Helius's own Parsed Transaction History API (the same one src/lib/portfolio/backfill.ts uses), asking for
 * the wallet's OLDEST transactions directly (`sort-order=asc`) instead of paginating backwards through RPC
 * signatures — one HTTP call either way.
 */

export type FirstFunderCheck = "self_funded" | "clean" | "unknown";

type HeliusTx = { nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[] };

/** How many of the wallet's very first transactions are inspected for its first incoming SOL transfer. */
const LOOKBACK = 5;

/**
 * "self_funded": the first SOL `referred` ever received came from `referrer` — reject the referral.
 * "clean": a first incoming transfer was found and it wasn't from `referrer` — a real referral.
 * "unknown": couldn't be determined (no Helius key, the call failed, or the wallet's early history has no
 *  plain SOL transfer in the first few transactions) — callers must NOT bind the referral on "unknown" and
 *  should retry on a later sign-in, since this is the one check that exists specifically to stop wallets
 *  gaming the campaign for money.
 */
export async function firstFunderCheck(referred: string, referrer: string, fetchImpl: typeof fetch = fetch): Promise<FirstFunderCheck> {
  const apiKey = heliusApiKeyFromRpcUrl(serverRpcUrl());
  if (!apiKey) return "unknown";
  try {
    const url = `https://api.helius.xyz/v0/addresses/${referred}/transactions?api-key=${apiKey}&sort-order=asc&limit=${LOOKBACK}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return "unknown";
    for (const tx of body as HeliusTx[]) {
      for (const t of tx.nativeTransfers ?? []) {
        if (t.toUserAccount !== referred || !(Number(t.amount) > 0)) continue;
        return t.fromUserAccount === referrer ? "self_funded" : "clean";
      }
    }
    return "unknown"; // no incoming SOL transfer in the first few transactions — inconclusive, not "clean"
  } catch {
    return "unknown";
  }
}
