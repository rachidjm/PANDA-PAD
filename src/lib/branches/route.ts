import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";

/** Branches need themes AND their own flag; both are off unless exactly "true" (fail closed). */
export const branchesEnabled = () => isEnabled("NFT_THEMES") && isEnabled("NFT_BRANCHES");
export const notAvailable = () => NextResponse.json({ error: "Not available." }, { status: 404 });

/**
 * The gate every signed-in branch route passes first: feature on, same origin, a wallet session (the acting wallet is
 * ALWAYS the session's, never a field of the request) and rate limits. Returns the wallet, or the response to send.
 */
export async function branchGate(req: Request, key: string, perWallet = 20): Promise<{ wallet: string } | NextResponse> {
  if (!branchesEnabled()) return notAvailable();
  if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (await rateLimited(`branch:${key}:wallet:${wallet}`, perWallet, 60_000) || await rateLimited(`branch:${key}:ip:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many requests — wait a minute.", code: "RATE_LIMITED" }, { status: 429 });
  }
  return { wallet };
}
