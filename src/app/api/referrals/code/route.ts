import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetCodeForWallet, pgSetRecruiterCode } from "@/lib/db/fee-tier";
import { normalizeRecruiterCode, recruiterCodeProblem } from "@/lib/referrals/codes";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: the short code a wallet already picked, or null. The mapping is meant to be public — it's
 *  exactly what a "/r/<code>" link reveals to anyone who follows it. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-code:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const code = await pgGetCodeForWallet(getDb(), wallet);
    return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ code: null });
    return NextResponse.json({ error: "Couldn't read the code." }, { status: 502 });
  }
}

/** Sets the wallet's own short code — once, permanently (see pgSetRecruiterCode). Requires a signed session
 *  for that exact wallet, same pattern as /api/rewards/claim. */
export async function POST(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`referrals-code:ip:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const wallet = body?.wallet;
  const rawCode = body?.code;
  if (typeof wallet !== "string" || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (typeof rawCode !== "string") return NextResponse.json({ error: "Missing code." }, { status: 400 });

  if ((await getSessionWallet(req)) !== wallet) {
    return NextResponse.json({ error: "Sign in with this wallet to set its code.", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const code = normalizeRecruiterCode(rawCode);
  const problem = recruiterCodeProblem(code);
  if (problem) return NextResponse.json({ outcome: "invalid", problem }, { status: 400 });

  try {
    const outcome = await pgSetRecruiterCode(getDb(), wallet, code, Date.now());
    return NextResponse.json({ outcome, ...(outcome === "set" ? { code } : {}) });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ error: "Not available right now." }, { status: 503 });
    return NextResponse.json({ error: "Couldn't set the code." }, { status: 502 });
  }
}
