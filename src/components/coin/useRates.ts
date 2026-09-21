"use client";

import { useEffect, useState } from "react";
import type { BuyRates } from "@/lib/trading/amount";

/** The real, current SOL and euro rates (each null when its source did not answer), refreshed every 45 seconds. */
export function useRates(mint: string): BuyRates {
  const [rates, setRates] = useState<BuyRates>({ solUsd: null, eurUsd: null });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/strategy/quote?mint=${mint}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((q: { solUsd?: number | null; eurUsd?: number | null } | null) => {
          if (!cancelled && q) setRates({ solUsd: q.solUsd ?? null, eurUsd: q.eurUsd ?? null });
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mint]);
  return rates;
}
