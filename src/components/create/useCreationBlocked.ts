"use client";

import { useEffect, useState } from "react";

export type CreationStatus = {
  /** True while the server says coin creation is paused (mainnet, treasury not yet declared a multisig). Trading is unaffected. */
  blocked: boolean;
  /** True when a launch (coin + fee split) is a single transaction; false when it takes two. Unknown until the server answers. */
  singleTx: boolean;
};

export function useCreationStatus(): CreationStatus {
  const [status, setStatus] = useState<CreationStatus>({ blocked: false, singleTx: false });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/protocol/status")
      .then((r) => r.json())
      .then((d) => !cancelled && setStatus({ blocked: d?.creation?.allowed === false, singleTx: d?.creation?.singleTx === true }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

export function useCreationBlocked(): boolean {
  return useCreationStatus().blocked;
}
