import { getThemeBySlug } from "@/lib/themes/store";
import { listSales } from "@/lib/market/store";
import { listStandings } from "@/lib/abuse/store";
import type { BranchDeps } from "./service";

/** The production wiring of the branch service: the market's verified sales and the anti-abuse standings. */
export function realBranchDeps(): BranchDeps {
  return {
    now: () => Date.now(),
    getTheme: getThemeBySlug,
    salesOfTheme: async (themeId) =>
      (await listSales(themeId)).map((s) => ({
        assetAddress: s.assetAddress,
        buyer: s.buyer,
        seller: s.seller,
        creator: s.creator,
        priceLamports: s.priceLamports,
        status: s.status,
        ts: s.completedAt ?? s.createdAt,
      })),
    flaggedWallets: async () => new Set((await listStandings()).filter((d) => d.status !== "NORMAL").map((d) => d.wallet)),
  };
}
