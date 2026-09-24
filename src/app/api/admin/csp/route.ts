import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { cspMode } from "@/lib/security/csp";
import { topViolations } from "@/lib/security/csp-store";

/** Auth: admin. The CSP mode and the aggregated violations the browsers reported (what would be blocked once CSP_MODE=enforce). */
export async function GET(req: Request) {
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  try {
    const res = NextResponse.json({ mode: cspMode(), violations: await topViolations(50) });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't read the reports." }, { status: 500 });
  }
}
