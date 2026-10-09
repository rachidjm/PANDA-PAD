import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { submitOrders } from "@/lib/panda-orders/service";

/** Step 2: the signed orders — each must be byte for byte what /prepare built, signed by this wallet. Stored encrypted. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "submit", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await submitOrders(realDeps(), { wallet: g.wallet, groupId: b.groupId, signed: b.signed });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
