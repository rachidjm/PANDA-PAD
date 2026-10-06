/**
 * How Draw Your Trade shows and reads the numbers it edits (buy, sell and stop levels), on the chart's own unit:
 * a market cap ("$6,69M") or a token price with the decimals it needs ("$0,00012"). The same text is shown when the
 * field is focused, and whatever the user types is read back the same way: "6,69M", "6.69m", "$0,00012", "6687622".
 * Pure functions only, so the formatting is tested without a browser.
 */

export type DisplayUnit = "price" | "mcap";

/** Decimals a token price needs to show its first significant digits (0.00012 → 6, 1.5 → 2, 250 → 2). */
export function priceDecimals(n: number): number {
  if (n >= 1) return 2;
  if (n >= 0.01) return 4;
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(n)) - 1);
  return Math.min(leadingZeros + 3, 10);
}

/** "$6,69M" / "$0,00012" in the given language. Empty for a value that can't be shown. */
export function formatDisplayValue(n: number, unit: DisplayUnit, lang: string): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (unit === "mcap") {
    const [div, suffix] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
    const value = n / div;
    const text = value.toLocaleString(lang, { minimumFractionDigits: 0, maximumFractionDigits: div === 1 ? 0 : 2 });
    return `$${text}${suffix}`;
  }
  const decimals = priceDecimals(n);
  return `$${n.toLocaleString(lang, { minimumFractionDigits: 0, maximumFractionDigits: decimals })}`;
}

const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Reads what the user typed back into a plain USD-or-cap number, or null when it isn't a positive amount.
 * A comma or a dot can be the decimal mark: when both appear the LAST one is the decimal mark ("1.234,5" and
 * "1,234.5" both work); when only one appears more than once it's a thousands separator ("6.687.622").
 */
export function parseDisplayValue(text: string): number | null {
  let s = text.trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!s) return null;
  let multiplier = 1;
  const suffix = s.match(/([kKmMbB])$/);
  if (suffix) {
    multiplier = MULTIPLIER[suffix[1].toLowerCase()];
    s = s.slice(0, -1);
  }
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    const decimalAt = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    normalized = `${s.slice(0, decimalAt).replace(/[.,]/g, "")}.${s.slice(decimalAt + 1).replace(/[.,]/g, "")}`;
  } else if (hasComma) {
    const parts = s.split(",");
    normalized = parts.length > 2 ? thousands(s, ",") : parts.join(".");
  } else if (hasDot) {
    normalized = s.split(".").length > 2 ? thousands(s, ".") : s;
  } else {
    normalized = s;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized) * multiplier;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A separator repeated is only a thousands separator when it groups exactly three digits ("6.687.622"). */
function thousands(s: string, sep: string): string {
  const groups = s.split(sep);
  const [first, ...rest] = groups;
  if (!/^\d{1,3}$/.test(first) || rest.some((g) => !/^\d{3}$/.test(g))) return "";
  return groups.join("");
}

/** The characters an edit may contain while typing (digits, separators, $ and the K/M/B suffix). */
export function sanitizeDisplayInput(text: string): string {
  return text.replace(/[^0-9.,$\sKkMmBb]/g, "");
}
