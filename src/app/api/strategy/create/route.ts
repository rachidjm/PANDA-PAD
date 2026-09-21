import { NextResponse } from "next/server";
import { realDeps } from "@/lib/strategy/deps";
import { failureResponse, guardWrite, readBody } from "@/lib/strategy/route";
import { createStrategy } from "@/lib/strategy/service";

/** Step 2: the wallet-signed deposit goes to Jupiter together with the prepared order — exactly once per strategy. */
export async function POST(req: Request) {
  const g = guardWrite(req, "create", 10);
  if (g instanceof NextResponse) return g;
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const result = await createStrategy(realDeps(), { wallet: g.wallet, token: g.token, id: body.id, depositSignedTx: body.depositSignedTx });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ strategy: result.record });
}
