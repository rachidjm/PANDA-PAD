import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { realDeps } from "@/lib/strategy/deps";
import { failureResponse, guardWrite } from "@/lib/strategy/route";
import { syncStrategies } from "@/lib/strategy/service";

/** Reads back from Jupiter what happened to the wallet's live strategies and advances their status (only on confirmed transactions). */
export async function POST(req: Request) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  const g = await guardWrite(req, "sync", 20);
  if (g instanceof NextResponse) return g;
  const result = await syncStrategies(realDeps(), { wallet: g.wallet, token: g.token });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ strategies: result.strategies });
}
