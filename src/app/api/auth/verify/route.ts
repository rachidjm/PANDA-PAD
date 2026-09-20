import { NextResponse } from "next/server";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { burnNonce, isNonceFormat, readNonce, sameOrigin, sessionSecret, setSessionCookie } from "@/lib/auth/session";
import { buildSignInMessage, verifyEd25519 } from "@/lib/auth/wallet-auth";
import { recordAudit } from "@/lib/audit/log";

const FAIL = { error: "Sign-in failed — please try again." };

/**
 * Auth: none (this proves wallet ownership). Body: { wallet, nonce, signature (base58) }.
 * The signed message is rebuilt here from the server's own stored challenge and
 * this request's host, so the client cannot influence what was signed. The
 * nonce is burned atomically before a session is issued: one signature, one login.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (!sessionSecret()) return NextResponse.json({ error: "Sign-in isn't available right now." }, { status: 503 });
  if (rateLimited(`auth-verify:ip:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    const { nonce, signature } = body ?? {};
    let walletKey: PublicKey;
    try {
      walletKey = new PublicKey(body?.wallet);
    } catch {
      return NextResponse.json(FAIL, { status: 400 });
    }
    const wallet = walletKey.toBase58();
    const domain = req.headers.get("host");
    if (!domain || !isNonceFormat(nonce) || typeof signature !== "string" || signature.length > 128) {
      return NextResponse.json(FAIL, { status: 400 });
    }

    const record = await readNonce(nonce);
    if (!record || record.used || record.wallet !== wallet || Date.now() > record.expiresAt) {
      return NextResponse.json(FAIL, { status: 401 });
    }

    let sigBytes: Uint8Array;
    try {
      sigBytes = bs58.decode(signature);
    } catch {
      return NextResponse.json(FAIL, { status: 400 });
    }
    const message = buildSignInMessage({ domain, wallet, nonce, issuedAt: record.issuedAt, expiresAt: record.expiresAt });
    if (!verifyEd25519(new TextEncoder().encode(message), sigBytes, walletKey.toBytes())) {
      return NextResponse.json(FAIL, { status: 401 });
    }

    // Atomic single-use: a concurrent replay of the same signature loses here.
    if (!(await burnNonce(nonce, wallet))) return NextResponse.json(FAIL, { status: 401 });

    await recordAudit({ req, actor: wallet, action: "auth.login", object: "session" });
    const res = NextResponse.json({ wallet });
    setSessionCookie(res, wallet);
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't complete sign-in — try again." }, { status: 500 });
  }
}
