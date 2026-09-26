import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { parseAdminWallets } from "@/lib/auth/admin-policy";
import { hiddenResponse } from "@/lib/auth/admin";

/**
 * Auth: none. Body: { wallet }. Answers `{ eligible: true }` when that wallet is listed in ADMIN_WALLETS — so the wallet menu can offer
 * "Sign in as admin" to it and to nobody else — and an empty 404 for every other wallet (the same answer as a path that doesn't exist).
 * It grants nothing: becoming an admin still needs a signed challenge (the normal sign-in) and every admin route re-checks the session.
 * Rate limited hard per IP so it can't be used to test a list of addresses.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return hiddenResponse();
  if (await rateLimited(`admin-eligible:ip:${clientIp(req)}`, 10, 60_000)) return new NextResponse(null, { status: 429 });
  const body = await req.json().catch(() => null);
  let wallet: string;
  try {
    wallet = new PublicKey(body?.wallet).toBase58();
  } catch {
    return hiddenResponse();
  }
  if (!parseAdminWallets(process.env.ADMIN_WALLETS).has(wallet)) return hiddenResponse();
  const res = NextResponse.json({ eligible: true });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
