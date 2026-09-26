import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { requireAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { getDb } from "@/lib/db/client";
import { pgAuditHead, pgListAnchors, pgRecordAnchor, pgVerifyChain } from "@/lib/db/audit";
import { anchorMemo, anchorTxMatches } from "@/lib/audit/anchor";
import { recordAudit } from "@/lib/audit/log";
import { storageMode } from "@/lib/db/mode";

/**
 * Admin: publish the audit chain's head hash on Solana (memo transaction the admin signs in the browser).
 *   { action: "head" }                 → { seq, hash, memo } for the browser to sign (the chain is verified first: a broken chain is never anchored)
 *   { action: "record", signature }    → re-reads that transaction from the chain and stores the anchor ONLY if it is confirmed, signed by this
 *                                        admin and carries exactly the memo for the head it claims
 *   { action: "list" }                 → past anchors
 * Requires the audit trail to be in Postgres (dual or postgres).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (storageMode("audit") === "blob") return NextResponse.json({ error: "The audit trail isn't in Postgres yet (PANDA_STORAGE_MODES audit=dual or postgres)." }, { status: 409 });

  const body = await req.json().catch(() => null);
  try {
    const db = getDb();
    if (body?.action === "list") return NextResponse.json({ anchors: await pgListAnchors(db) });
    if (body?.action === "head") {
      const verdict = await pgVerifyChain(db);
      if (!verdict.ok) return NextResponse.json({ error: `The chain is broken (seq ${verdict.problem?.seq}): ${verdict.problem?.reason}`, code: "CHAIN_BROKEN" }, { status: 409 });
      const head = await pgAuditHead(db);
      if (!head) return NextResponse.json({ error: "The audit trail is empty." }, { status: 409 });
      return NextResponse.json({ seq: head.seq, hash: head.hash, length: head.length, memo: anchorMemo(head.seq, head.hash) });
    }
    if (body?.action === "record" && typeof body.signature === "string") {
      const connection = new Connection(serverRpcUrl(), "confirmed");
      const tx = await connection.getParsedTransaction(body.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      const head = await pgAuditHead(db);
      // The memo names a head; it must be one that really is in the chain (the head at signing time, or an earlier event).
      const m = /seq=(\d+) head=([0-9a-f]{64})/.exec(JSON.stringify(tx?.transaction.message.instructions ?? []));
      if (!m || !head) return NextResponse.json({ error: "That transaction has no PANDA audit memo." }, { status: 400 });
      const seq = Number(m[1]);
      const hash = m[2];
      if (!anchorTxMatches(tx as never, admin.wallet, seq, hash)) return NextResponse.json({ error: "The transaction isn't a confirmed memo signed by you." }, { status: 400 });
      const verdict = await pgVerifyChain(db);
      if (!verdict.ok) return NextResponse.json({ error: "The chain is broken; not recording the anchor." }, { status: 409 });
      await pgRecordAnchor(db, { headSeq: seq, headHash: hash, signature: body.signature, wallet: admin.wallet });
      // Recorded AFTER the anchor row so this event itself isn't part of what was anchored.
      await recordAudit({ req, actor: admin.wallet, action: "audit.anchored", object: `seq:${seq}`, newState: { hash, signature: body.signature } });
      const after = await pgVerifyChain(db); // an anchor that doesn't match the chain would show up right away
      return NextResponse.json({ recorded: true, chainOk: after.ok });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
