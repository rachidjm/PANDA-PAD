import { NextResponse } from "next/server";
import { failure, guardOrders, readJson } from "@/lib/panda-orders/route";
import { realDeps } from "@/lib/panda-orders/deps";
import { submitModify } from "@/lib/panda-orders/modify";

/** Changing a live order, step 2: the signed replacement swaps in for the old order (whose stored signature is erased). */
export async function POST(req: Request) {
  const g = await guardOrders(req, "modify-submit", 20);
  if (g instanceof NextResponse) return g;
  const b = await readJson(req);
  if (!b) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const r = await submitModify(realDeps(), { wallet: g.wallet, signed: b.signed });
  if (!r.ok) return failure(r);
  return NextResponse.json(r);
}
