import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { listAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { storageMode } from "@/lib/db/mode";
import { getDb } from "@/lib/db/client";
import { pgVerifyChain, pgAuditHead } from "@/lib/db/audit";

/** Auth: admin. Query: ?limit=1..100 (default 50). Output: { events } newest first. */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  try {
    // ?verify=1 (only when the trail is in Postgres): re-derive the whole hash chain and report it.
    let chain: unknown = null;
    if (new URL(req.url).searchParams.get("verify") === "1" && storageMode("audit") !== "blob") {
      const verdict = await pgVerifyChain(getDb());
      chain = { ...verdict, length: (await pgAuditHead(getDb()))?.length ?? 0 };
    }
    const res = NextResponse.json({ events: await listAudit(Number.isFinite(limit) ? limit : 50), chain, mode: storageMode("audit") });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't read the audit log." }, { status: 500 });
  }
}
