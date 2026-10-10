import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { prepareModify } from "@/lib/panda-orders/modify";

export const maxDuration = 30;

/** Changing a live order or cancelling one line of a pair, step 1: what to sign in one batch — the transaction that voids
 *  the old orders on chain, and the tranche's orders as they should be now, on the wallet's reserve account. (A wallet with
 *  no reserve yet gets the setup transaction first.) Nothing changes until /modify/submit. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "modify", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await prepareModify(realDeps(), { wallet: g.wallet, groupId: b.groupId, trancheId: b.trancheId, sellUsd: b.sellUsd, stopUsd: b.stopUsd, pct: b.pct, drop: b.drop, riskAccepted: b.riskAccepted, setupSignature: b.setupSignature });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
