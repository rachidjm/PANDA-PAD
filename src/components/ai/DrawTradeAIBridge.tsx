"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { DrawApi } from "@/components/coin/draw/useDrawTrade";

/**
 * Lets the AI Assistant's "Ayuda con Draw Your Trade" panel (rendered once, at the app root — it can be
 * opened from any page) reach whichever coin page currently has a live `useDrawTrade` instance, without
 * prop-drilling it through the whole tree. A coin page registers itself on mount and unregisters on unmount
 * (see useRegisterDrawTradeForAI, called from PriceChart.tsx); everywhere else `draw` is simply null, and the
 * assistant explains it needs a coin page open instead of offering the option.
 */

type Ctx = { draw: DrawApi | null; coin: { mint: string; ticker: string; currentPriceUsd: number | null } | null; setDraw: (v: Ctx["draw"], coin: Ctx["coin"]) => void };

const DrawTradeAIContext = createContext<Ctx | null>(null);

export function DrawTradeAIBridgeProvider({ children }: { children: React.ReactNode }) {
  const [draw, setDrawState] = useState<DrawApi | null>(null);
  const [coin, setCoinState] = useState<Ctx["coin"]>(null);
  const value = useMemo<Ctx>(
    () => ({
      draw,
      coin,
      setDraw: (v, c) => {
        setDrawState(v);
        setCoinState(c);
      },
    }),
    [draw, coin]
  );
  return <DrawTradeAIContext.Provider value={value}>{children}</DrawTradeAIContext.Provider>;
}

export function useDrawTradeAIBridge(): Ctx {
  const ctx = useContext(DrawTradeAIContext);
  if (!ctx) throw new Error("useDrawTradeAIBridge must be used inside DrawTradeAIBridgeProvider");
  return ctx;
}

/** Called unconditionally from PriceChart.tsx (a hook can't be called conditionally) — registers its live
 *  `draw` API and the coin's own identity/current price for the assistant to use, for as long as that chart
 *  stays mounted; an empty `mint` (no coin — Draw Your Trade isn't offered there at all) simply unregisters. */
export function useRegisterDrawTradeForAI(draw: DrawApi, mint: string, ticker: string, currentPriceUsd: number | null): void {
  const { setDraw } = useDrawTradeAIBridge();
  useEffect(() => {
    if (!mint) return;
    setDraw(draw, { mint, ticker, currentPriceUsd });
    return () => setDraw(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, mint, ticker, currentPriceUsd]);
}
