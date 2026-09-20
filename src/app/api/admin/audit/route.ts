import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { listAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";

/** Auth: admin. Query: ?limit=1..100 (default 50). Output: { events } newest first. */
export async function GET(req: Request) {
  if (rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  try {
    const res = NextResponse.json({ events: await listAudit(Number.isFinite(limit) ? limit : 50) });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't read the audit log." }, { status: 500 });
  }
}
