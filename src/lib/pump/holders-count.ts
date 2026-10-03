import { getRedis } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { heliusApiKeyFromRpcUrl } from "@/lib/solana/helius";

/**
 * A coin's holder count — real, from Helius's `getTokenAccounts` DAS RPC method, paged to an exact count.
 * `showZeroBalance: false` (the default) already excludes empty accounts, and the method itself indexes both
 * the legacy SPL Token program and Token-2022 the same way, so no extra handling is needed for either of
 * those. The one real trap: Helius's own `total` field is NOT the token's total holder count — per its own
 * docs ("the number of results found FOR THE REQUEST") it's just this page's size, capped at `limit`. Asking
 * for `limit: 1` and reading `total` (the previous version of this function) always returns 1 whenever the
 * token has at least one holder, regardless of how many it really has — confirmed directly against Helius's
 * API reference, not guessed. Fixed by paging through with `cursor` and counting real returned accounts
 * until a page comes back short (the true last page). Capped at MAX_PAGES so one very widely-held token (BONK,
 * JUP, ...) can't turn one page load into thousands of round trips — past that cap the real total genuinely
 * isn't known cheaply, so this returns null (shown as "—") rather than a count that LOOKS exact but is really
 * just "at least this many".
 */

const TTL_S = 10 * 60;
const TIMEOUT_MS = 5_000;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 10; // up to 10,000 holders counted exactly; beyond that, null ("—") rather than a disguised floor
const KEY = (mint: string) => `panda:holders:v2:${mint}`;

export async function fetchHolderCount(mint: string, rpcUrl: string = serverRpcUrl(), fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const apiKey = heliusApiKeyFromRpcUrl(rpcUrl);
  if (!apiKey) return null;
  try {
    let count = 0;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "panda-holders",
          method: "getTokenAccounts",
          params: { mint, limit: PAGE_LIMIT, cursor, options: { showZeroBalance: false } },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: { token_accounts?: unknown[]; cursor?: string } };
      const accounts = body.result?.token_accounts;
      if (!Array.isArray(accounts)) return null;
      count += accounts.length;
      if (accounts.length < PAGE_LIMIT) return count; // short page: this was genuinely the last one
      cursor = body.result?.cursor;
      if (!cursor) return count; // no cursor to continue with, even though the page was full
    }
    return null; // hit MAX_PAGES still going — the real total isn't cheap to know, so don't pretend otherwise
  } catch {
    return null;
  }
}

export async function getHolderCount(mint: string): Promise<number | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<number>(KEY(mint));
      if (typeof cached === "number") return cached;
    } catch {
      // Falls through to a real fetch.
    }
  }
  const count = await fetchHolderCount(mint);
  if (count !== null && redis) {
    try {
      await redis.set(KEY(mint), count, { ex: TTL_S });
    } catch {
      // Best-effort — the real count was already read and is returned below regardless.
    }
  }
  return count;
}
