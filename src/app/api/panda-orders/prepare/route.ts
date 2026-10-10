import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { prepareOrders } from "@/lib/panda-orders/service";

export const maxDuration = 30;

/** Step 1: re-validates the drawing against the chain and returns either the one-time setup transaction (the order
 *  accounts) or the order transactions to sign. Nothing becomes an order until /submit. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "prepare", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await prepareOrders(realDeps(), { wallet: g.wallet, mint: b.mint, ticker: b.ticker, groupId: b.groupId, n: b.n, pool: b.pool, tranches: b.tranches, riskAccepted: b.riskAccepted, setupSignature: b.setupSignature });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
