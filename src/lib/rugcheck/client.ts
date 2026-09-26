"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { RugSummary } from "./summary";

/**
 * Browser side: one shared store of RugCheck answers, batched into a single request per moment (the home page has dozens of cards) and
 * polled while some are still `pending` on the server (RugCheck's rate limit means they arrive a few at a time). A coin with no usable
 * answer ends as `null`: nothing is shown for it. Only PANDA's own /api/rugcheck is called.
 */

const known = new Map<string, RugSummary | null>(); // null = asked, nothing to show
const wanted = new Set<string>();
const tries = new Map<string, number>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

const MAX_TRIES = 6;
const BATCH = 30;
const POLL_MS = 8_000;

const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function schedule(delay: number) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

async function flush() {
  if (inFlight || wanted.size === 0) return;
  inFlight = true;
  const batch = [...wanted].slice(0, BATCH);
  try {
    const res = await fetch(`/api/rugcheck?mints=${batch.join(",")}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { results?: Record<string, RugSummary>; pending?: string[] };
    const pending = new Set(body.pending ?? []);
    for (const mint of batch) {
      const summary = body.results?.[mint];
      if (summary) {
        known.set(mint, summary);
        wanted.delete(mint);
      } else if (pending.has(mint)) {
        const n = (tries.get(mint) ?? 0) + 1;
        tries.set(mint, n);
        if (n >= MAX_TRIES) {
          known.set(mint, null);
          wanted.delete(mint);
        }
      } else {
        known.set(mint, null); // RugCheck has nothing usable: show nothing
        wanted.delete(mint);
      }
    }
  } catch {
    for (const mint of batch) {
      const n = (tries.get(mint) ?? 0) + 1;
      tries.set(mint, n);
      if (n >= 3) {
        known.set(mint, null);
        wanted.delete(mint);
      }
    }
  } finally {
    inFlight = false;
    notify();
    if (wanted.size > 0) schedule(POLL_MS);
  }
}

function want(mint: string) {
  if (known.has(mint) || wanted.has(mint)) return;
  wanted.add(mint);
  schedule(60); // let the other cards on the page join the same request
}

/** RugCheck's summary for a coin: `undefined` while unknown, `null` when there is nothing to show, else the summary. Asks only when `enabled`. */
export function useRugSummary(mint: string, enabled = true): RugSummary | null | undefined {
  useEffect(() => {
    if (enabled) want(mint);
  }, [mint, enabled]);
  return useSyncExternalStore(
    subscribe,
    () => known.get(mint),
    () => undefined
  );
}
