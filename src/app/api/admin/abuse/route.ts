import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { recordAudit } from "@/lib/audit/log";
import { ABUSE_CONFIG } from "@/lib/abuse/config";
import { ABUSE_STATUSES, AbuseStatus } from "@/lib/abuse/types";
import { changeStatus, getStanding, listReports, listStandings, resolveAppeal } from "@/lib/abuse/store";
import { realAbuseDeps } from "@/lib/abuse/deps";
import { runAnalysis } from "@/lib/abuse/run";

/**
 * Auth: admin (fresh wallet session of an ADMIN_WALLETS wallet), same-origin. Gated by PANDA_POINTS.
 *
 * GET ?epoch=N            -> the analysis reports of that epoch (newest last)
 * GET ?wallet=<address>   -> one wallet's standing: status, history, appeals
 * GET                     -> every wallet that has a status other than NORMAL
 * POST, each with an exact `confirm` phrase, all audited:
 *   { action: "analyze", epochId, confirm: "RUN ABUSE ANALYSIS" }
 *       Runs the engine. The only thing it changes is opening REVIEW on flagged wallets
 *       (which takes nothing away from them); stronger statuses are proposals in the report.
 *   { action: "decide", wallet, status, reason, confirm: "<PHRASE>" }
 *       Sets a status by hand. Phrases: REVIEW -> "REVIEW WALLET", RESTRICTED -> "RESTRICT WALLET",
 *       DISQUALIFIED -> "DISQUALIFY WALLET", NORMAL -> "CLEAR WALLET".
 *   { action: "resolve_appeal", wallet, appealId, decision: "accepted"|"rejected", note, confirm: "RESOLVE APPEAL" }
 *       Closes an appeal. It does NOT change the status: accepting an appeal and clearing the wallet are two
 *       separate, deliberate decisions.
 */

const PHRASES: Record<AbuseStatus, string> = {
  NORMAL: "CLEAR WALLET",
  REVIEW: "REVIEW WALLET",
  RESTRICTED: "RESTRICT WALLET",
  DISQUALIFIED: "DISQUALIFY WALLET",
};

export async function GET(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (rateLimited(`admin:ip:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const url = new URL(req.url);
  const headers = { "Cache-Control": "no-store" };
  try {
    const epoch = url.searchParams.get("epoch");
    if (epoch !== null) {
      const id = Number(epoch);
      if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "Invalid epoch." }, { status: 400 });
      return NextResponse.json({ configVersion: ABUSE_CONFIG.version, reports: await listReports(id) }, { headers });
    }
    const wallet = url.searchParams.get("wallet");
    if (wallet !== null) return NextResponse.json({ standing: await getStanding(wallet) }, { headers });
    const flagged = (await listStandings()).filter((d) => d.status !== "NORMAL" || d.appeals.some((a) => a.status === "open"));
    return NextResponse.json({ configVersion: ABUSE_CONFIG.version, flagged }, { headers });
  } catch {
    return NextResponse.json({ error: "Couldn't load abuse data." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const b = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!b || typeof b.action !== "string") return bad("Invalid request.");
  const now = Date.now();

  try {
    if (b.action === "analyze") {
      if (b.confirm !== "RUN ABUSE ANALYSIS") return bad('Confirmation must be exactly "RUN ABUSE ANALYSIS".');
      if (!Number.isSafeInteger(b.epochId) || b.epochId < 1) return bad("Invalid epoch.");
      // Each run reads a lot of storage and the chain: at most a few per minute.
      if (rateLimited(`abuse-run:${admin.wallet}`, 3, 60_000)) return bad("Too many analysis runs — wait a minute.", 429);
      const r = await runAnalysis({ epochId: b.epochId, actor: admin.wallet }, realAbuseDeps());
      if (!r.ok) return bad(r.error);
      await recordAudit({
        req,
        actor: admin.wallet,
        action: "abuse.analyze",
        object: `epoch:${b.epochId}`,
        newState: { runId: r.report.runId, findings: r.report.findings.length, reviewOpened: r.report.reviewOpened, coverage: r.report.coverage, configVersion: r.report.configVersion },
      });
      return NextResponse.json({ report: r.report });
    }

    if (b.action === "decide") {
      if (typeof b.wallet !== "string" || typeof b.status !== "string" || !(ABUSE_STATUSES as readonly string[]).includes(b.status)) return bad("Invalid wallet or status.");
      const status = b.status as AbuseStatus;
      if (b.confirm !== PHRASES[status]) return bad(`Confirmation must be exactly "${PHRASES[status]}".`);
      if (typeof b.reason !== "string") return bad("A reason is required.");
      const before = (await getStanding(b.wallet)).status;
      const r = await changeStatus(b.wallet, { to: status, actor: { kind: "admin", wallet: admin.wallet }, reason: b.reason }, now);
      if (!r.ok) return bad(r.error);
      await recordAudit({ req, actor: admin.wallet, action: "abuse.decide", object: b.wallet, oldState: { status: before }, newState: { status: r.after }, reason: b.reason.trim().slice(0, 300) });
      return NextResponse.json({ wallet: b.wallet, before: r.before, after: r.after });
    }

    if (b.action === "resolve_appeal") {
      if (b.confirm !== "RESOLVE APPEAL") return bad('Confirmation must be exactly "RESOLVE APPEAL".');
      if (typeof b.wallet !== "string" || typeof b.appealId !== "string" || (b.decision !== "accepted" && b.decision !== "rejected") || typeof b.note !== "string") return bad("Invalid request.");
      const r = await resolveAppeal(b.wallet, b.appealId, b.decision, admin.wallet, b.note, now);
      if (!r.ok) return bad(r.error);
      await recordAudit({ req, actor: admin.wallet, action: "abuse.appeal.resolve", object: b.wallet, newState: { appealId: b.appealId, decision: b.decision }, reason: b.note.trim().slice(0, 300) });
      return NextResponse.json({ ok: true, note: "The status was not changed — use decide to change it." });
    }

    return bad("Unknown action.");
  } catch {
    return NextResponse.json({ error: "That failed — try again." }, { status: 500 });
  }
}
