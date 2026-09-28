"use client";

import { useEffect, useRef, useState } from "react";
import { getJupiterQuote } from "@/lib/jupiter/client";

export type ImpactEstimate = { pct: number | null; exceedsCurve: boolean; loading: boolean };

const EMPTY: ImpactEstimate = { pct: null, exceedsCurve: false, loading: false };

/**
 * How far a trade would move the price, estimated live as the user types — from the coin's own bonding-curve
 * reserves while it's still on Pump.fun's curve (src/app/api/pump/impact/route.ts), from Jupiter's own public
 * quote once it has graduated or trades on an external dex (the same source BuyPandaWidget.tsx already uses).
 * A pure estimate at current market conditions, debounced, never built into a transaction — Draw Your Trade's
 * buy fires later, at the target price, so this is informational, same as the execution-price disclaimer.
 */
export function usePriceImpact(params: {
  mint: string;
  /** True only while the coin hasn't graduated and isn't an external-dex coin. */
  onCurve: boolean;
  side: "buy" | "sell";
  /** on-curve buy: SOL going in. */
  solAmount?: number;
  /** on-curve sell: token raw units going in. */
  tokenAmountRaw?: string;
  /** off-curve (Jupiter) path. */
  inputMint?: string;
  outputMint?: string;
  inputAmountRaw?: string;
}): ImpactEstimate {
  const { mint, onCurve, side, solAmount, tokenAmountRaw, inputMint, outputMint, inputAmountRaw } = params;
  const [state, setState] = useState<ImpactEstimate>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    const onCurveReady = onCurve && (side === "buy" ? (solAmount ?? 0) > 0 : !!tokenAmountRaw && tokenAmountRaw !== "0");
    const offCurveReady = !onCurve && !!inputAmountRaw && inputAmountRaw !== "0" && !!inputMint && !!outputMint;
    if (!mint || (!onCurveReady && !offCurveReady)) {
      Promise.resolve().then(() => setState(EMPTY));
      return;
    }
    const my = ++seq.current;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      const run = onCurve
        ? fetch(`/api/pump/impact?mint=${mint}&side=${side}&${side === "buy" ? `solAmount=${solAmount}` : `tokenAmount=${tokenAmountRaw}`}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { onCurve?: boolean; impactPct?: number | null; exceedsCurve?: boolean } | null): { pct: number | null; exceedsCurve: boolean } =>
              d && d.onCurve ? { pct: d.impactPct ?? null, exceedsCurve: !!d.exceedsCurve } : { pct: null, exceedsCurve: false }
            )
            .catch(() => ({ pct: null, exceedsCurve: false }))
        : getJupiterQuote({ inputMint: inputMint!, outputMint: outputMint!, amount: inputAmountRaw!, slippageBps: 500 })
            .then((q) => ({ pct: Math.abs(Number(q.priceImpactPct) || 0) * 100, exceedsCurve: false }))
            .catch(() => ({ pct: null, exceedsCurve: false }));
      run.then((r) => {
        if (my === seq.current) setState({ ...r, loading: false });
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [mint, onCurve, side, solAmount, tokenAmountRaw, inputMint, outputMint, inputAmountRaw]);

  return state;
}
