import { NextResponse } from "next/server";
import { realDeps } from "@/lib/strategy/deps";
import { failureResponse, guardWrite, readBody } from "@/lib/strategy/route";
import { prepareStrategy } from "@/lib/strategy/service";

/** Step 1 of confirming a strategy: re-validates everything server-side and builds the deposit for the wallet to sign. Nothing is placed yet. */
export async function POST(req: Request) {
  const g = guardWrite(req, "prepare", 20);
  if (g instanceof NextResponse) return g;
  const body = await readBody(req);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const amount = (body.amount && typeof body.amount === "object" ? body.amount : {}) as { unit?: unknown; value?: unknown };
  const result = await prepareStrategy(realDeps(), {
    wallet: g.wallet,
    token: g.token,
    id: body.id,
    n: body.n,
    mint: body.mint,
    ticker: body.ticker,
    buyUsd: body.buyUsd,
    sellUsd: body.sellUsd,
    stopUsd: body.stopUsd,
    amount: { unit: amount.unit, value: amount.value },
    fundingAsset: body.fundingAsset,
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ strategy: result.record, transaction: result.transaction });
}
