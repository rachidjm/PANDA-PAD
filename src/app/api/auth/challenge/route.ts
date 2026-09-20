import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sessionSecret, sameOrigin, storeNonce } from "@/lib/auth/session";
import { buildSignInMessage, CHALLENGE_TTL_MS, newNonce } from "@/lib/auth/wallet-auth";

/**
 * Auth: none (this is the start of sign-in). Body: { wallet }. Returns a
 * one-time challenge for that wallet to sign. Rate limited per IP and wallet.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (!sessionSecret()) return NextResponse.json({ error: "Sign-in isn't available right now." }, { status: 503 });
  if (rateLimited(`auth-challenge:ip:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    let wallet: string;
    try {
      wallet = new PublicKey(body?.wallet).toBase58();
    } catch {
      return NextResponse.json({ error: "Invalid wallet." }, { status: 400 });
    }
    if (rateLimited(`auth-challenge:wallet:${wallet}`, 6, 60_000)) {
      return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
    }

    const domain = req.headers.get("host");
    if (!domain) return NextResponse.json({ error: "Bad request." }, { status: 400 });

    const nonce = newNonce();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_MS;
    await storeNonce(nonce, { wallet, issuedAt, expiresAt, used: false });

    return NextResponse.json({
      nonce,
      message: buildSignInMessage({ domain, wallet, nonce, issuedAt, expiresAt }),
    });
  } catch {
    return NextResponse.json({ error: "Couldn't start sign-in — try again." }, { status: 500 });
  }
}
