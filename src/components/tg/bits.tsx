import { formatPrice, formatUsd } from "@/lib/format";

/** Small pieces every screen of the Mini App shares. */
export const shortMint = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;
export const money = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : formatUsd(n));
export const priceLabel = (n: number | null | undefined) => (n === null || n === undefined || !(n > 0) ? "—" : formatPrice(n));

export function Change({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return <span className="text-panda-grey">{"—"}</span>;
  return <span className={pct >= 0 ? "text-bamboo" : "text-clay-red"}>{`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>;
}
