"use client";

import { useEffect, useState } from "react";

/** True while the server says coin creation is paused (mainnet, treasury not yet declared a multisig). Trading is unaffected. */
export function useCreationBlocked(): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/protocol/status")
      .then((r) => r.json())
      .then((d) => !cancelled && setBlocked(d?.creation?.allowed === false))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return blocked;
}
