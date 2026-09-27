/**
 * Helius's own Parsed Transaction History API (https://www.helius.dev/docs/api-reference/enhanced-transactions/gettransactionsbyaddress
 * — `GET /v0/addresses/{address}/transactions`, `type` filter, up to 100 per call), used ONLY to get a wallet's
 * recent swap SIGNATURES pre-filtered by Helius's own parser (`type=SWAP`) in one HTTP call, instead of scanning
 * every recent signature (transfers, NFT mints, votes, ...) through the RPC one by one. The actual SOL/token
 * amounts still come from `getParsedTransaction` + `deriveTrade` (src/lib/portfolio/derive-trade.ts) exactly as
 * before — that logic reads raw balance deltas, so it works for pump.fun's own bonding curve too, which a
 * program-name-based parser like this one may not recognise as a "swap". Returns null (never throws) when there's
 * no Helius API key configured or the call fails, so callers fall back to the plain RPC scan.
 */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The API key baked into `SOLANA_RPC_URL` when it's a Helius RPC URL (`?api-key=...`) — the enhanced API takes the same key. */
export function heliusApiKeyFromRpcUrl(rpcUrl: string): string | null {
  try {
    const u = new URL(rpcUrl);
    if (!u.hostname.endsWith("helius-rpc.com")) return null;
    return u.searchParams.get("api-key") || null;
  } catch {
    return null;
  }
}

export type SwapSignature = { signature: string; ts: number };

/** Up to `limit` (max 100) of this wallet's most recent signatures Helius itself tags as a SWAP, newest first. Null on any failure. */
export async function fetchSwapSignatures(wallet: string, apiKey: string, limit = 100, fetchImpl: typeof fetch = fetch): Promise<SwapSignature[] | null> {
  if (!ADDRESS.test(wallet)) return null;
  try {
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&type=SWAP&limit=${Math.min(100, limit)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return null;
    const out: SwapSignature[] = [];
    for (const tx of body) {
      if (typeof tx !== "object" || tx === null) continue;
      const signature = (tx as { signature?: unknown }).signature;
      const timestamp = (tx as { timestamp?: unknown }).timestamp;
      if (typeof signature === "string" && typeof timestamp === "number") out.push({ signature, ts: timestamp * 1000 });
    }
    return out;
  } catch {
    return null;
  }
}
