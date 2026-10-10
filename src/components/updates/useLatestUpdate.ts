"use client";

import { useCallback, useEffect, useState } from "react";
import { hasUnseen, SEEN_EVENT, SEEN_KEY } from "@/lib/updates/seen";

export type LatestUpdate = { id: string; ts: number; tag: string; title: { en: string; es: string } };

/** One request per page load, shared by the menu, the phone row and the home card. */
let pending: Promise<LatestUpdate | null> | null = null;
function loadLatest(): Promise<LatestUpdate | null> {
  pending ??= fetch("/api/updates/latest")
    .then((r) => (r.ok ? (r.json() as Promise<{ latest: LatestUpdate | null }>) : { latest: null }))
    .then((d) => d.latest ?? null)
    .catch(() => null);
  return pending;
}

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null; // storage blocked: the dot simply stays until /updates is opened in this visit
  }
};

/**
 * The newest update and whether this visitor has seen it. "Seen" is remembered in this browser (the address of the newest
 * update at the time /updates was last opened) — nothing is stored on PANDA's side.
 */
export function useLatestUpdate(): { latest: LatestUpdate | null; unseen: boolean; markSeen: (id: string) => void } {
  const [latest, setLatest] = useState<LatestUpdate | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLatest().then((l) => {
      if (!alive) return;
      setLatest(l);
      setSeen(readSeen());
      setReady(true);
    });
    const sync = () => setSeen(readSeen());
    window.addEventListener(SEEN_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      alive = false;
      window.removeEventListener(SEEN_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const markSeen = useCallback((id: string) => {
    try {
      localStorage.setItem(SEEN_KEY, id);
    } catch {
      // nothing to remember it in
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, []);

  return { latest, unseen: ready && hasUnseen(latest?.id, seen), markSeen };
}
