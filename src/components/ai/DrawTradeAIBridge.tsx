"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DrawApi } from "@/components/coin/draw/useDrawTrade";

/**
 * Lets the AI Assistant's "Ayuda con Draw Your Trade" panel (rendered once, at the app root — it can be
 * opened from any page) reach whichever coin page currently has a live `useDrawTrade` instance, without
 * prop-drilling it through the whole tree. A coin page registers itself on mount and unregisters on unmount
 * (see useRegisterDrawTradeForAI, called from PriceChart.tsx); everywhere else `draw` is simply null, and the
 * assistant explains it needs a coin page open instead of offering the option.
 *
 * `draw` itself (the live `useDrawTrade()` return value) lives in a plain ref, not React state: it's a new
 * object every render of the coin page by design, and storing it in state here would mean every one of those
 * renders updates THIS provider's state, which — because the provider wraps the whole app — re-renders the
 * coin page itself, producing a new `draw` object again, forever (confirmed directly: an infinite
 * "Maximum update depth exceeded" loop on every coin page once Draw Your Trade is on, which pegs the tab and
 * makes every click, including header/nav links, feel dead). Only `coin` (mint/ticker/currentPriceUsd — a few
 * primitives that only change when you actually switch coins) is real React state, so consumers only
 * re-render when something meaningful changed.
 */

type CoinInfo = { mint: string; ticker: string; currentPriceUsd: number | null };
type Ctx = { getDraw: () => DrawApi | null; coin: CoinInfo | null; registerDraw: (v: DrawApi | null) => void; setCoin: (c: CoinInfo | null) => void };

const DrawTradeAIContext = createContext<Ctx | null>(null);

export function DrawTradeAIBridgeProvider({ children }: { children: React.ReactNode }) {
  const drawRef = useRef<DrawApi | null>(null);
  const [coin, setCoin] = useState<CoinInfo | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      getDraw: () => drawRef.current,
      coin,
      registerDraw: (v) => {
        drawRef.current = v;
      },
      setCoin,
    }),
    [coin]
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
  const { registerDraw, setCoin } = useDrawTradeAIBridge();

  // Keeps the bridge pointed at the latest `draw` on every render — a plain ref mutation, never a state
  // update, so this can never retrigger a render on its own (see the module comment for why that matters).
  useEffect(() => {
    registerDraw(mint ? draw : null);
  });

  // Real React state, but only for the few primitives that actually identify "which coin, at what price" —
  // this only re-runs (and only re-renders the assistant) when one of those genuinely changes.
  useEffect(() => {
    if (!mint) return;
    setCoin({ mint, ticker, currentPriceUsd });
    return () => setCoin(null);
  }, [mint, ticker, currentPriceUsd, setCoin]);
}
