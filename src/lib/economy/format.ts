/** Display helpers for the economy numbers. Amounts stay integers until the very last step. */

/** Lamports as SOL text: up to 4 decimals, fewer once it is large. Never rounds a non-zero amount down to "0". */
export function formatSolAmount(lamports: number, lang: string): string {
  if (lamports === 0) return "0";
  const sol = lamports / 1e9;
  if (sol < 0.0001) return "<0.0001".replace(".", lang === "es" ? "," : ".");
  return sol.toLocaleString(lang, { maximumFractionDigits: sol >= 1000 ? 0 : sol >= 100 ? 1 : sol >= 1 ? 2 : 4 });
}

/** Token base units (decimal string, any size) as text with `decimals` decimals — exact, no floating point. `decimals` null = raw units. */
export function formatTokenUnits(base: string, decimals: number | null, lang: string): string {
  let n: bigint;
  try {
    n = BigInt(base);
  } catch {
    return "—";
  }
  if (decimals === null || decimals <= 0) return n.toLocaleString(lang);
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = n / unit;
  const frac = ((n % unit) * BigInt(100)) / unit; // two decimals, truncated
  const w = whole.toLocaleString(lang);
  return frac === BigInt(0) ? w : `${w}${lang === "es" ? "," : "."}${frac.toString().padStart(2, "0")}`;
}
