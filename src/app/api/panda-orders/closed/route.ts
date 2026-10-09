import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { confirmClosed } from "@/lib/panda-orders/service";

/** After the close landed: marks what the CHAIN shows as closed — the browser's word is never enough. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "closed", 30);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await confirmClosed(realDeps(), { wallet: g.wallet, nonceAccounts: b.nonceAccounts });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
