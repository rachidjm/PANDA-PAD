import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { guardOrders } from "@/lib/panda-orders/route";
import { realDeps, realExecutionDeps } from "@/lib/panda-orders/deps";
import { logExecutions } from "@/lib/panda-orders/executions";
import { listOrders } from "@/lib/panda-orders/service";

/** The signed-in wallet's PANDA orders (every coin, or one with ?mint=), what is already promised on that coin, and the
 *  deposits that can be recovered. Never any signed bytes. */
export async function GET(req: Request) {
  const g = await guardOrders(req, "list", 60, { read: true });
  if (g instanceof NextResponse) return g;
  const mint = new URL(req.url).searchParams.get("mint") ?? undefined;
  if (mint) {
    try {
      new PublicKey(mint);
    } catch {
      return NextResponse.json({ error: "Invalid coin address." }, { status: 400 });
    }
  }
  const list = await listOrders(realDeps(), { wallet: g.wallet, mint });
  // An executed order that isn't in this wallet's trade log yet (it executed before logging existed, or the cron missed
  // it) is added now, from its own transaction — that is what puts it on the chart. Never fails the listing.
  try {
    await logExecutions(realExecutionDeps(), list.orders);
  } catch {
    // tried again on the next load
  }
  return NextResponse.json(list);
}
