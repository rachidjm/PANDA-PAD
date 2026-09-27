import { NextResponse } from "next/server";
import { eurUsdRate } from "@/lib/strategy/market";

/** The real EUR→USD rate for the Portfolio page's €/$ toggle — same live source as the buy/sell screens (frankfurter.dev), just without needing a token mint. Null when it can't be read: the page then keeps showing USD rather than guess a rate. */
export async function GET() {
  const eurUsd = await eurUsdRate();
  return NextResponse.json({ eurUsd }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=1800" } });
}
