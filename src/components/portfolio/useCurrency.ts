"use client";

import { useCallback, useEffect, useState } from "react";
import type { Currency } from "@/lib/format";

const KEY = "panda:portfolio:currency";

function readStored(): Currency | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "USD" || v === "EUR" ? v : null;
  } catch {
    return null; // private window, blocked storage, ... — just means nothing is remembered yet
  }
}

/**
 * The €/$ toggle for the Portfolio page: remembered per browser (a display preference, not app state — never
 * synced, never read by anyone but this viewer). Until anything is chosen, it defaults by language (EUR for
 * Spanish, USD otherwise) rather than hardcoding one. The real EUR→USD rate is fetched once and kept fresh
 * every 30 minutes; `eurUsd` is null (never a guessed 1.1) until it answers, in which case the page keeps
 * showing USD regardless of the selection.
 */
export function useCurrency(lang: string): { currency: Currency; setCurrency: (c: Currency) => void; eurUsd: number | null } {
  // The initial value must be the SAME on the server and on the client's first (hydration) render — reading
  // localStorage here (client-only) would make them differ and break hydration. So this starts at the
  // language-based default always, and the effect below silently corrects it to the remembered choice right
  // after mount, exactly like LanguageProvider does for the site's language.
  const [currency, setCurrencyState] = useState<Currency>(lang === "es" ? "EUR" : "USD");
  const [eurUsd, setEurUsd] = useState<number | null>(null);

  useEffect(() => {
    // A macrotask (not a microtask/`Promise.then`) — deferred strictly until AFTER hydration's commit is
    // fully done and the browser has painted, so this correction can never race React's concurrent hydration
    // and cause a server/client mismatch (a `Promise.resolve().then()` can still land mid-hydration for a
    // large tree, since React 19's concurrent hydration itself yields across microtask boundaries).
    const timer = setTimeout(() => {
      const stored = readStored();
      if (stored) setCurrencyState(stored);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      // Not remembered this time — the toggle still works for the rest of the visit.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/portfolio/rates", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { eurUsd?: number | null } | null) => {
          if (!cancelled) setEurUsd(d?.eurUsd ?? null);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 30 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { currency, setCurrency, eurUsd };
}
