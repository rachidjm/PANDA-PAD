import { getRedis } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { heliusApiKeyFromRpcUrl } from "@/lib/solana/helius";

/**
 * A coin's holder count — real, from Helius's `getTokenAccounts` DAS RPC method (one call, `limit: 1`, reads
 * only the `total` field it reports; no need to page through every account just to count them). `null` when
 * the RPC isn't a Helius one (this method is Helius-specific, not standard Solana RPC) or the call fails —
 * never a fabricated number. Cached in Upstash for 10 minutes, same reasoning as RugCheck's badge cache: many
 * people look at the same coin, this stays cheap either way.
 */

const TTL_S = 10 * 60;
const TIMEOUT_MS = 5_000;
const KEY = (mint: string) => `panda:holders:v1:${mint}`;

export async function fetchHolderCount(mint: string, rpcUrl: string = serverRpcUrl(), fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const apiKey = heliusApiKeyFromRpcUrl(rpcUrl);
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "panda-holders", method: "getTokenAccounts", params: { mint, limit: 1, options: { showZeroBalance: false } } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { total?: unknown } };
    const total = body.result?.total;
    return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : null;
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
