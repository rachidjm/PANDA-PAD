import { NextResponse } from "next/server";
import { getLiveCoins, searchLiveCoins } from "@/lib/live-coins";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  if (q && q.trim()) {
    try {
      const { coins, live } = await searchLiveCoins(q);
      return NextResponse.json({ coins, live });
    } catch {
      return NextResponse.json(
        { error: "Search is briefly unavailable (rate-limited upstream) — try again in a moment." },
        { status: 503 }
      );
    }
  }
  const force = params.get("force") === "1";
  const { coins, live } = await getLiveCoins({ force });
  return NextResponse.json({ coins, live });
}
