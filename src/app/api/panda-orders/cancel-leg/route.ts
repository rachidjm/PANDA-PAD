import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { cancelLeg } from "@/lib/panda-orders/modify";

/** Cancels ONE line of an order that has two (the other keeps working). First call: the message to sign. Second call,
 *  with the wallet's signature over it: the line is cancelled and its stored signed transaction erased. */
export async function POST(req: Request) {
  const g = await guardOrders(req, "cancel-leg", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  const domain = req.headers.get("host");
  if (!b || !domain) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await cancelLeg(realDeps(), { wallet: g.wallet, orderId: b.orderId, issuedAt: b.issuedAt, signature: b.signature, domain });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
