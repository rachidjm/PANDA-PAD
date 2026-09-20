/** Display helpers for the economy numbers. Amounts stay integers until the very last step. */

/** Lamports as SOL text: up to 4 decimals, fewer once it is large. Never rounds a non-zero amount down to "0". */
export function formatSolAmount(lamports: number, lang: string): string {
  if (lamports === 0) return "0";
  const sol = lamports / 1e9;
  if (sol < 0.0001) return "<0.0001".replace(".", lang === "es" ? "," : ".");
  return sol.toLocaleString(lang, { maximumFractionDigits: sol >= 1000 ? 0 : sol >= 100 ? 1 : sol >= 1 ? 2 : 4 });
}

/**
 * Token base units (decimal string, any size) as text with `decimals` decimals — exact, no floating point. `decimals` null = raw units.
 * `fractionDigits` is how many decimals are shown (truncated, never rounded up, trailing zeros dropped); pass `decimals` for the full amount.
 */
export function formatTokenUnits(base: string, decimals: number | null, lang: string, fractionDigits = 2): string {
  let n: bigint;
  try {
    n = BigInt(base);
  } catch {
    return "—";
  }
  if (decimals === null || decimals <= 0) return n.toLocaleString(lang);
  const digits = Math.max(0, Math.min(fractionDigits, decimals));
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = n / unit;
  const frac = ((n % unit) * BigInt(10) ** BigInt(digits)) / unit; // truncated
  const w = whole.toLocaleString(lang);
  const fracText = frac.toString().padStart(digits, "0").replace(/0+$/, "");
  return fracText === "" ? w : `${w}${lang === "es" ? "," : "."}${fracText}`;
}
