/**
 * SOL <-> lamports for the UI and for parsing what a seller types. Integer math
 * on strings: "1.25" is exactly 1_250_000_000 lamports, never 1249999999.99...
 */

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** "1", "0.5", "1.234567891" (up to 9 decimals) -> lamports; null for anything else (negative, exponent, commas, empty...). */
export function solToLamports(input: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,9}))?$/.exec(input.trim());
  if (!m) return null;
  const lamports = Number(m[1]) * LAMPORTS_PER_SOL + Number((m[2] ?? "").padEnd(9, "0") || "0");
  return Number.isSafeInteger(lamports) ? lamports : null;
}

/** 1_250_000_000 -> "1.25"; 1 -> "0.000000001". Trailing zeros trimmed. */
export function lamportsToSol(lamports: number): string {
  const whole = Math.floor(lamports / LAMPORTS_PER_SOL);
  const frac = String(lamports % LAMPORTS_PER_SOL).padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
