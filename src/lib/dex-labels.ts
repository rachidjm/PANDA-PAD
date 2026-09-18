const DEX_LABELS: Record<string, string> = {
  raydium: "Raydium",
  "raydium-clmm": "Raydium",
  orca: "Orca",
  meteora: "Meteora",
  "meteora-dlmm": "Meteora",
  byreal: "Byreal",
  zerofi: "ZeroFi",
  "saros-amm": "Saros",
  fluxbeam: "Fluxbeam",
};

export function dexLabel(dex?: string): string {
  if (!dex) return "another DEX";
  return DEX_LABELS[dex] || dex.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
