import { fetchTokensMulti, type GeckoTokenSummary } from "@/lib/gecko/client";
import { fetchJupiterTokens, type JupToken } from "@/lib/jupiter/tokens";

/**
 * What a wallet's Portfolio needs to show a token the way a wallet app does: its name, symbol, logo, USD price and 24 h change. GeckoTerminal
 * first (one batched request per 30 mints); Jupiter's token search fills what it lacks (name, logo, price, 24 h change). A field neither source
 * has stays absent — the page then shows nothing for it, never a made-up value.
 */
export type TokenMeta = { name?: string; symbol?: string; image?: string; priceUsd?: number; change24h?: number };

const isRealImage = (u: string | null | undefined): u is string => !!u && /^https:\/\//.test(u) && !/missing/.test(u);

export function mergeMeta(gecko: GeckoTokenSummary | undefined, jup: JupToken | undefined): TokenMeta {
  const geckoPrice = Number(gecko?.price_usd);
  return {
    name: gecko?.name || jup?.name || undefined,
    symbol: gecko?.symbol || jup?.symbol || undefined,
    image: isRealImage(gecko?.image_url) ? gecko!.image_url! : jup?.image,
    priceUsd: Number.isFinite(geckoPrice) && geckoPrice > 0 ? geckoPrice : jup?.priceUsd,
    change24h: gecko?.change24h ?? jup?.change24h,
  };
}

export async function getTokenMeta(mints: string[], deps: { gecko?: typeof fetchTokensMulti; jupiter?: typeof fetchJupiterTokens } = {}): Promise<Record<string, TokenMeta>> {
  const unique = [...new Set(mints)];
  const gecko = await (deps.gecko ?? fetchTokensMulti)(unique);
  const out: Record<string, TokenMeta> = {};
  const gaps: string[] = [];
  for (const m of unique) {
    const meta = mergeMeta(gecko.get(m), undefined);
    out[m] = meta;
    if (!meta.name || !meta.symbol || !meta.image || meta.priceUsd === undefined || meta.change24h === undefined) gaps.push(m);
  }
  if (gaps.length) {
    const jup = await (deps.jupiter ?? fetchJupiterTokens)(gaps);
    for (const m of gaps) out[m] = mergeMeta(gecko.get(m), jup.get(m));
  }
  return out;
}
