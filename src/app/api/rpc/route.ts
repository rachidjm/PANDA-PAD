import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited, rateVerdict } from "@/lib/rate-limit";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";

/**
 * Read-only JSON-RPC proxy: lets the browser query wallet balances and token
 * accounts through PANDA's server-side RPC provider without the provider's
 * API key ever reaching the client. Deliberately narrow — an allowlist of
 * the methods a wallet needs to read state, send an already-signed
 * transaction and check on it; same-origin callers only, small bodies,
 * rate-limited (sends more tightly). It never holds or signs anything.
 */
const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "getBlockHeight",
  "getSignatureStatuses",
  "getTransaction", // read-only: lets the app say WHY a transaction failed
  "sendTransaction",
  "simulateTransaction",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "isBlockhashValid",
  "getBalance",
  "getTokenAccountsByOwner",
  "getTokenSupply",
  "getTokenAccountBalance",
  "getAccountInfo",
  "getMultipleAccounts",
]);

function rpcError(code: number, message: string, status: number) {
  return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return rpcError(-32000, "Forbidden origin.", 403);
  if (await rateLimited(`rpc:${clientIp(req)}`, 120, 60_000)) return rpcError(-32005, "Too many requests.", 429);

  const text = await req.text();
  if (text.length > 8_000) return rpcError(-32600, "Request too large.", 413);

  let calls: { method?: string }[];
  try {
    const body = JSON.parse(text);
    calls = Array.isArray(body) ? body : [body];
  } catch {
    return rpcError(-32700, "Invalid JSON.", 400);
  }
  if (calls.length > 10 || calls.some((c) => !c?.method || !ALLOWED_METHODS.has(c.method))) {
    return rpcError(-32601, "Method not allowed.", 403);
  }
  if (calls.some((c) => c.method === "sendTransaction")) {
    // Relaying a signed transaction is a money action: fails CLOSED if the limiter can't answer (reads above fail open).
    const verdict = await rateVerdict(`rpc-send:${clientIp(req)}`, 20, 60_000, "money");
    if (verdict === "limited") return rpcError(-32005, "Too many transactions.", 429);
    if (verdict === "unavailable") return rpcError(-32005, "Sending is briefly unavailable — please try again in a minute.", 503);
  }

  // A signed transaction is only forwarded while the network guard allows money to move (reads always go through).
  if (calls.some((c) => c.method === "sendTransaction") && (await moneyFlowGuardResponse())) {
    return rpcError(-32002, "Trading is paused: the network of this deployment's RPC could not be confirmed.", 503);
  }

  try {
    const upstream = await fetch(serverRpcUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return rpcError(-32003, "RPC provider unreachable.", 502);
  }
}
