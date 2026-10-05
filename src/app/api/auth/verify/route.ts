import { NextResponse } from "next/server";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { burnNonce, isNonceFormat, issueSession, readNonce, sameOrigin, sessionSecret } from "@/lib/auth/session";
import { buildSignInMessage, verifyEd25519 } from "@/lib/auth/wallet-auth";
import { recordAudit } from "@/lib/audit/log";
import { tryApplyRecruiterCode, tryBindReferral } from "@/lib/referrals/bind";

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
  if (await rateLimited(`auth-verify:ip:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => null);
    const { nonce, signature, ref, code } = body ?? {};
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

    // The affiliate campaign's first-touch link: `ref` is untrusted client input (whatever it read back from its
    // own `?ref=` URL) — tryBindReferral is the only thing that decides whether it actually counts, and it never
    // blocks or slows down sign-in itself (a referral problem is never an auth problem).
    let refBound: boolean | undefined;
    if (typeof ref === "string" && ref) {
      try {
        const outcome = await tryBindReferral(wallet, ref);
        if (outcome !== "retry_later") refBound = outcome === "bound"; // terminal either way — client stops offering `ref` again
      } catch (err) {
        console.error("[PANDA referrals] bind attempt failed", err instanceof Error ? err.message : err);
      }
    }

    // The manual "have a code?" field in the disconnected wallet menu — same untrusted-input, server-decides
    // contract as `ref` above. If `ref` already bound a referrer this call, tryApplyRecruiterCode's own
    // pgGetReferrer check makes this a harmless no-op ("already_bound") rather than a race between the two.
    let codeBound: boolean | undefined;
    if (typeof code === "string" && code) {
      try {
        const outcome = await tryApplyRecruiterCode(wallet, code);
        if (outcome !== "retry_later") codeBound = outcome === "bound";
      } catch (err) {
        console.error("[PANDA referrals] code-apply attempt failed", err instanceof Error ? err.message : err);
      }
    }

    const res = NextResponse.json({
      wallet,
      ...(refBound !== undefined ? { refBound } : {}),
      ...(codeBound !== undefined ? { codeBound } : {}),
    });
    const { jti } = await issueSession(res, wallet); // in postgres mode a session that can't be registered is not issued
    await recordAudit({ req, actor: wallet, action: "auth.login", object: "session", newState: { jti } });
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't complete sign-in — try again." }, { status: 500 });
  }
}
