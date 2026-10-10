import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { submitModify } from "@/lib/panda-orders/modify";

/** Step 2: PANDA sends the signed nonce advance and, only once the chain confirms it, swaps the old orders for the new
 *  ones. `advance_pending` = not confirmed yet, nothing changed: call again with the same body. */
export const maxDuration = 30;
export async function POST(req: Request) {
  const g = await guardOrders(req, "modify-submit", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await submitModify(realDeps(), { wallet: g.wallet, groupId: b.groupId, trancheId: b.trancheId, ticket: b.ticket, advance: b.advance, signed: b.signed });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
