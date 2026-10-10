import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { closeNonces } from "@/lib/panda-orders/service";

/** Cancel (a strategy or one tranche) or recover free deposits: builds the transaction that closes the order accounts
 *  back into the wallet. The wallet signs and sends it; then /closed confirms what the chain shows. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "close", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await closeNonces(realDeps(), { wallet: g.wallet, groupId: b.groupId, trancheId: b.trancheId, recover: b.recover, allOf: b.allOf });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
