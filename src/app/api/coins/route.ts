import { NextResponse } from "next/server";
import { getLiveCoins, searchLiveCoins } from "@/lib/live-coins";
import { buildSearchResults, type RankedCoin } from "@/lib/market/search-rank";
import { getJupiterVerifications } from "@/lib/jupiter/verification-cache";
import { searchDominantLiquidityRatio, searchMinLiquidityUsd, searchNameMaxDistanceRatio } from "@/lib/config/search-limits";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * The coin list. By default only coins that pass the data-quality gate (src/lib/quality) — the junk pools with absurd
 * market caps are set aside, never shown. `?quality=suspect` returns just those set-aside coins with their reasons
 * (to audit the filter); `?quality=all` returns both, for screens that need a held coin's name or logo even if its
 * numbers can't be trusted (Portfolio, Rewards). Suspect coins are marked (`quality`, `qualityReasons`) either way.
 *
 * A search (`?q=`) additionally de-duplicates by ticker/near-identical name (src/lib/market/search-rank.ts): `coins`
 * stays the flat, one-per-group list every existing caller already expects, and `groups`/`hidden` are new, additive
 * fields for a results screen that wants to show "+N coins with this name" and a collapsed low-liquidity bucket.
 * `?held=<mint1,mint2,...>` names mints the searching wallet holds, which (like a PANDA-launched coin) are never
 * collapsed into the hidden bucket regardless of liquidity.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  const quality = params.get("quality");
  const pick = <T,>(ok: T[], suspect: T[]) => (quality === "suspect" ? suspect : quality === "all" ? [...ok, ...suspect] : ok);
  if (q && q.trim()) {
    try {
      const { coins, suspect, live } = await searchLiveCoins(q);
      const picked = pick(coins, suspect);

      const verifications = await getJupiterVerifications(picked.map((c) => c.mint));
      const ranked: RankedCoin[] = picked.map((c) => {
        const v = verifications.get(c.mint);
        return { ...c, verified: v?.verified ?? false, liquidityUsd: c.liquidityUsd ?? v?.liquidityUsd };
      });

      const trimmed = q.trim();
      const exactMint = ADDRESS.test(trimmed) ? ranked.find((c) => c.mint.toLowerCase() === trimmed.toLowerCase())?.mint ?? null : null;
      const held = (params.get("held") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const neverHide = new Set<string>([...held, ...ranked.filter((c) => c.launchedOnPanda).map((c) => c.mint)]);

      const { groups, hidden } = buildSearchResults(
        ranked,
        trimmed,
        { minLiquidityUsd: searchMinLiquidityUsd(), dominantLiquidityRatio: searchDominantLiquidityRatio(), nameMaxDistanceRatio: searchNameMaxDistanceRatio() },
        { exactMint, neverHide }
      );

      return NextResponse.json({ coins: groups.map((g) => g.primary), groups, hidden, live });
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
