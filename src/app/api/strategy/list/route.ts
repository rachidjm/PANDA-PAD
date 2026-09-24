import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { getSessionWallet } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";
import { listStrategies } from "@/lib/strategy/store";

/** The signed-in wallet's saved strategies with their last known status (nothing here talks to Jupiter). */
export async function GET(req: Request) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (await rateLimited(`strategy-list:${wallet}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const mint = new URL(req.url).searchParams.get("mint");
  const all = await listStrategies(wallet, Date.now());
  return NextResponse.json({ strategies: mint ? all.filter((s) => s.mint === mint) : all }, { headers: { "Cache-Control": "no-store" } });
}
