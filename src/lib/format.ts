export function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** "3 minutes ago" / "hace 3 minutos" in the given language, from a timestamp in ms. */
export function formatRelativeTime(ts: number, lang: string, now: number = Date.now()): string {
  const diffSec = Math.round((ts - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return fmt.format(diffSec, "second");
  if (abs < 3600) return fmt.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return fmt.format(Math.round(diffSec / 3600), "hour");
  return fmt.format(Math.round(diffSec / 86400), "day");
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** USD formatting for real dollar amounts (portfolio/reward values) — keeps cents for small
 *  amounts, unlike `formatCompact`, which is for large stats like market cap. */
export function formatUsd(n: number): string {
  if (Math.abs(n) >= 1000) return formatCompact(n);
  return `$${n.toFixed(2)}`;
}

/** Adapts decimal precision so very small memecoin prices don't render as $0.0000. */
export function formatPrice(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(n)) - 1);
  return `$${n.toFixed(Math.min(leadingZeros + 3, 10))}`;
}
