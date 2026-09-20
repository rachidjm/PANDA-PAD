"use client";

import { useEffect, useState } from "react";
import EconomyView, { EconomyState, PublicAddresses } from "./EconomyView";
import type { EconomySnapshot } from "@/lib/economy/snapshot";

const POLL_MS = 60_000;

/** Loads PANDA's own numbers from the public API and keeps them fresh; the layout is EconomyView. */
export default function EconomySection({ addresses }: { addresses: PublicAddresses }) {
  const [data, setData] = useState<EconomySnapshot | null>(null);
  const [state, setState] = useState<EconomyState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetch("/api/analytics/economy", { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<EconomySnapshot>) : Promise.reject(new Error("economy"))))
        .then((s) => {
          setData(s);
          setState("ready");
        })
        .catch((err) => {
          if (err?.name !== "AbortError") setState((prev) => (prev === "ready" ? prev : "error"));
        });
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, []);

  return <EconomyView data={data} state={state} addresses={addresses} />;
}
