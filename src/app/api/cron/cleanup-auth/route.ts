import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { storageMode } from "@/lib/db/mode";
import { pgCleanupAuth } from "@/lib/db/sessions";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

/**
 * Daily cleanup (vercel.json cron): deletes sign-in nonces that expired more than a day ago and sessions that expired more than a week ago.
 * Live nonces and sessions are never touched. Guarded by CRON_SECRET like the other cron; a no-op while sessions are still in Blob.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // never run unguarded
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (storageMode("sessions") === "blob") return NextResponse.json({ skipped: "sessions are still in Blob" });
  try {
    const result = await pgCleanupAuth(getDb(), Date.now());
    await recordAudit({ actor: "system:cron", action: "cron.cleanup_auth", object: "auth", newState: result });
    return NextResponse.json(result);
  } catch (err) {
    await alertOps("cleanup-auth cron failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
}
