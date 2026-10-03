import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { canApplyRecruiterCode, tryApplyRecruiterCode } from "@/lib/referrals/bind";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: whether `wallet` could still apply a code right now (no referrer yet, no trade yet) —
 *  used to decide whether to even show the "have a code?" field/nudge. Never says WHY it can't. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-apply-code:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const eligible = await canApplyRecruiterCode(wallet);
  return NextResponse.json({ eligible }, { headers: { "Cache-Control": "no-store" } });
}

/** Applies a recruiter's short code to `wallet` — only once, only before its first trade (see
 *  tryApplyRecruiterCode). Requires a signed session for that exact wallet. */
export async function POST(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`referrals-apply-code:ip:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const wallet = body?.wallet;
  const code = body?.code;
  if (typeof wallet !== "string" || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (typeof code !== "string" || !code) return NextResponse.json({ error: "Missing code." }, { status: 400 });

  if ((await getSessionWallet(req)) !== wallet) {
    return NextResponse.json({ error: "Sign in with this wallet to apply a code.", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const outcome = await tryApplyRecruiterCode(wallet, code);
    return NextResponse.json({ outcome });
  } catch {
    return NextResponse.json({ error: "Couldn't apply that code right now." }, { status: 502 });
  }
}
