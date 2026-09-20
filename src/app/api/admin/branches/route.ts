import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { recordAudit } from "@/lib/audit/log";
import { branchesEnabled, notAvailable } from "@/lib/branches/route";
import { listBranches } from "@/lib/branches/store";
import { changeStatus } from "@/lib/branches/service";
import type { BranchStatus } from "@/lib/branches/branch";

/**
 * Auth: admin (fresh wallet session of an ADMIN_WALLETS wallet), same-origin, rate limited. Gated by NFT_THEMES + NFT_BRANCHES.
 * GET  -> every branch (full detail).
 * POST -> { action: "pause" | "resume" | "close", branchId, reason, confirm: "<ACTION> BRANCH <id>" }   e.g. "PAUSE BRANCH 3"
 * Pausing stops new NFTs (existing ones and their trading are untouched); resuming undoes it; closing is final.
 * Audited with the reason.
 */
export async function GET(req: Request) {
  if (!branchesEnabled()) return notAvailable();
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ branches: await listBranches() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load branches." }, { status: 500 });
  }
}

const TARGET: Record<string, BranchStatus> = { pause: "PAUSED", resume: "ACTIVE", close: "CLOSED" };

export async function POST(req: Request) {
  if (!branchesEnabled()) return notAvailable();
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const b = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!b || typeof b.action !== "string" || !Object.prototype.hasOwnProperty.call(TARGET, b.action) || !Number.isSafeInteger(b.branchId)) return bad("Invalid request.");
  if (b.confirm !== `${b.action.toUpperCase()} BRANCH ${b.branchId}`) return bad(`Confirmation must be exactly "${b.action.toUpperCase()} BRANCH ${b.branchId}".`);
  if (typeof b.reason !== "string" || b.reason.trim().length < 5) return bad("A reason of at least 5 characters is required.");

  try {
    const r = await changeStatus(Date.now(), { branchId: b.branchId, to: TARGET[b.action], actor: "admin" });
    if (!r.ok) return bad(r.error, r.status);
    await recordAudit({ req, actor: admin.wallet, action: `branch.${b.action}`, object: `branch:${b.branchId}`, oldState: { status: r.before }, newState: { status: r.branch.status }, reason: b.reason.trim().slice(0, 300) });
    return NextResponse.json({ branchId: b.branchId, before: r.before, after: r.branch.status });
  } catch {
    return bad("That failed — try again.", 500);
  }
}
