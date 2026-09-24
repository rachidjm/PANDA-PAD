import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { parseViolations } from "@/lib/security/csp";
import { recordViolations } from "@/lib/security/csp-store";

/**
 * Where browsers send Content-Security-Policy violation reports (both the legacy `report-uri` and the Reporting API formats).
 * Public by nature: it accepts small JSON bodies, keeps only directive/origin/page-path aggregates, and always answers 204 so a browser never
 * retries. Fail-open on the rate limiter (it isn't a money route).
 */
export async function POST(req: Request) {
  try {
    if (await rateLimited(`csp-report:${clientIp(req)}`, 60, 60_000)) return new NextResponse(null, { status: 204 });
    const text = await req.text();
    if (text.length > 8_000) return new NextResponse(null, { status: 204 });
    await recordViolations(parseViolations(JSON.parse(text)));
  } catch {
    // malformed reports are ignored
  }
  return new NextResponse(null, { status: 204 });
}
