import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit/log";
import { branchGate } from "@/lib/branches/route";
import { changeContributor, changeStatus } from "@/lib/branches/service";
import { publicBranch } from "@/lib/branches/view";

/**
 * Auth: signed-in wallet session — only a branch's CREATOR can manage it (checked in the service, atomically).
 * Body: { branchId, action: "add_contributor" | "remove_contributor" | "close", wallet? }.
 * A creator can close their branch for good but cannot pause or resume it (that is an admin decision). Audited.
 */
export async function POST(req: Request) {
  const gate = branchGate(req, "manage", 20);
  if (gate instanceof NextResponse) return gate;

  const b = await req.json().catch(() => null);
  if (!b || !Number.isSafeInteger(b.branchId) || typeof b.action !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const now = Date.now();
  try {
    if (b.action === "add_contributor" || b.action === "remove_contributor") {
      const r = await changeContributor(now, { wallet: gate.wallet, branchId: b.branchId, action: b.action === "add_contributor" ? "add" : "remove", target: b.wallet });
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      await recordAudit({ req, actor: gate.wallet, action: `branch.${b.action}`, object: `branch:${b.branchId}`, newState: { wallet: b.wallet, contributors: r.branch.contributors } });
      return NextResponse.json({ branch: publicBranch(r.branch, 0) });
    }
    if (b.action === "close") {
      const r = await changeStatus(now, { branchId: b.branchId, to: "CLOSED", actor: "creator", wallet: gate.wallet });
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      await recordAudit({ req, actor: gate.wallet, action: "branch.close", object: `branch:${b.branchId}`, oldState: { status: r.before }, newState: { status: "CLOSED" } });
      return NextResponse.json({ branch: publicBranch(r.branch, 0) });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "That failed — try again." }, { status: 500 });
  }
}
