import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { tryApplyRecruiterCode, tryBindReferral } from "@/lib/referrals/bind";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Retries a referral (a `?ref=` link and/or a typed recruiter code) that is still waiting on its anti-abuse
 *  check, for a wallet that already has a signed session — no new signature needed. Same untrusted-input,
 *  server-decides contract as /api/auth/verify: the answer is `refBound` / `codeBound` only when terminal. */
export async function POST(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`referrals-bind:ip:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const wallet = body?.wallet;
  if (typeof wallet !== "string" || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if ((await getSessionWallet(req)) !== wallet) {
    return NextResponse.json({ error: "Sign in with this wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const ref = typeof body?.ref === "string" && body.ref ? body.ref : null;
  const code = typeof body?.code === "string" && body.code ? body.code : null;
  let refBound: boolean | undefined;
  let codeBound: boolean | undefined;
  try {
    if (ref) {
      const outcome = await tryBindReferral(wallet, ref);
      if (outcome !== "retry_later") refBound = outcome === "bound";
    }
    if (code) {
      const outcome = await tryApplyRecruiterCode(wallet, code);
      if (outcome !== "retry_later") codeBound = outcome === "bound";
    }
  } catch {
    return NextResponse.json({ error: "Couldn't check that referral right now." }, { status: 502 });
  }
  return NextResponse.json({
    ...(refBound !== undefined ? { refBound } : {}),
    ...(codeBound !== undefined ? { codeBound } : {}),
  });
}
