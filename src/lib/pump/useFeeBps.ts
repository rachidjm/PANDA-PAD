"use client";

import { useEffect, useState } from "react";
import { PANDA_FEE_BPS } from "./constants";

/** The real per-wallet fee rate (bps), fetched from /api/wallet/fee-bps. Starts at the default rate and never
 *  flashes a wrong number while connecting or while not yet connected. */
export function useFeeBps(wallet: string | null | undefined): number {
  const [feeBps, setFeeBps] = useState(PANDA_FEE_BPS);

  useEffect(() => {
    if (!wallet) {
      Promise.resolve().then(() => setFeeBps(PANDA_FEE_BPS));
      return;
    }
    let cancelled = false;
    fetch(`/api/wallet/fee-bps?wallet=${wallet}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.feeBps === "number") setFeeBps(data.feeBps);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  return feeBps;
}
