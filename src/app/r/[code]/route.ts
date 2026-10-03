import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetWalletByCode } from "@/lib/db/fee-tier";
import { normalizeRecruiterCode } from "@/lib/referrals/codes";

export const dynamic = "force-dynamic";

/** A recruiter's short link: "/r/<code>" resolves the code to its owner's wallet and redirects to
 *  "/?ref=<wallet>" — from there, the existing `?ref=` capture pipeline (src/lib/referrals/client.ts) takes
 *  over unchanged. An unknown code, or the program being off, just goes home. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL("/", req.url);
  if (!isEnabled("REFERRALS")) return NextResponse.redirect(home);

  try {
    const wallet = await pgGetWalletByCode(getDb(), normalizeRecruiterCode(code));
    if (wallet) return NextResponse.redirect(new URL(`/?ref=${wallet}`, req.url));
  } catch (err) {
    if (!(err instanceof DbNotConfiguredError)) console.error("[PANDA r] code lookup failed", code, err);
  }
  return NextResponse.redirect(home);
}
