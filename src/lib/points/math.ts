import { POINTS_CONFIG } from "./config";

/** floor(sqrt(n)) for a non-negative safe integer, exact (Newton's method on bigint — no float rounding). */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("isqrt needs a non-negative safe integer.");
  if (n < 2) return n;
  const N = BigInt(n);
  let x = BigInt(Math.floor(Math.sqrt(n))) + BigInt(1);
  for (;;) {
    const y = (x + N / x) >> BigInt(1);
    if (y >= x) break;
    x = y;
  }
  while (x * x > N) x -= BigInt(1);
  while ((x + BigInt(1)) * (x + BigInt(1)) <= N) x += BigInt(1);
  return Number(x);
}

/** Points a wallet has earned from trading after `cumulativeVolumeLamports` in total (path-independent). */
export function tradePointsForVolume(cumulativeVolumeLamports: number, cfg = POINTS_CONFIG.trade): number {
  if (!Number.isSafeInteger(cumulativeVolumeLamports) || cumulativeVolumeLamports < 0) return 0;
  return isqrt(Math.floor(cumulativeVolumeLamports / cfg.lamportsPerUnit));
}

/** Extra points earned by adding one trade of `volumeLamports` to `beforeLamports` of earlier volume. */
export function tradePointsDelta(beforeLamports: number, volumeLamports: number, cfg = POINTS_CONFIG.trade): number {
  if (!Number.isSafeInteger(volumeLamports) || volumeLamports < cfg.minVolumeLamports) return 0;
  return tradePointsForVolume(beforeLamports + volumeLamports, cfg) - tradePointsForVolume(beforeLamports, cfg);
}
