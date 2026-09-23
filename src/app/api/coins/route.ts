import { NextResponse } from "next/server";
import { getLiveCoins, searchLiveCoins } from "@/lib/live-coins";

/**
 * The coin list. By default only coins that pass the data-quality gate (src/lib/quality) — the junk pools with absurd
 * market caps are set aside, never shown. `?quality=suspect` returns just those set-aside coins with their reasons
 * (to audit the filter); `?quality=all` returns both, for screens that need a held coin's name or logo even if its
 * numbers can't be trusted (Portfolio, Rewards). Suspect coins are marked (`quality`, `qualityReasons`) either way.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  const quality = params.get("quality");
  const pick = <T,>(ok: T[], suspect: T[]) => (quality === "suspect" ? suspect : quality === "all" ? [...ok, ...suspect] : ok);
  if (q && q.trim()) {
    try {
      const { coins, suspect, live } = await searchLiveCoins(q);
      return NextResponse.json({ coins: pick(coins, suspect), live });
    } catch {
      return NextResponse.json(
        { error: "Search is briefly unavailable (rate-limited upstream) — try again in a moment." },
        { status: 503 }
      );
    }
  }
  const force = params.get("force") === "1";
  const { coins, suspect, live } = await getLiveCoins({ force });
  return NextResponse.json({ coins: pick(coins, suspect), live });
}
