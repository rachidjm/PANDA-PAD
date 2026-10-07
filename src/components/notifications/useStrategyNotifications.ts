"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { countUnread, deriveNotifications, type StrategyNotification } from "@/lib/strategy/notifications";
import type { StrategyRecord } from "@/lib/strategy/types";

/**
 * The bell's own data: every executed leg across every strategy this wallet has ever drawn, and how many are
 * unread. The strategies themselves are the server's own history (nothing new is stored for that); only the
 * "already seen" cursor lives here, per wallet, in this browser — so it's fine for it to only catch up the
 * next time the wallet opens the app, same as the rest of Draw Your Trade's execution notices.
 */

const POLL_MS = 60_000;
const seenKey = (wallet: string) => `panda.notif.seen.${wallet}`;

function readSeen(wallet: string): number {
  try {
    const raw = localStorage.getItem(seenKey(wallet));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function useStrategyNotifications(enabled: boolean) {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [all, setAll] = useState<StrategyNotification[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState(0);

  // A fresh microtask, not a direct call in the effect body — same deferral WalletButton.tsx already uses for
  // its own "read something from this browser once we know who's connected" effect.
  useEffect(() => {
    Promise.resolve().then(() => setLastSeenAt(wallet ? readSeen(wallet) : 0));
  }, [wallet]);

  useEffect(() => {
    if (!enabled || !wallet) {
      Promise.resolve().then(() => setAll([]));
      return;
    }
    let cancelled = false;
    // No `mint`: every strategy this wallet has, across every coin — the bell's whole history.
    const load = () =>
      fetch("/api/strategy/list", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)) // not signed in yet (401) or a transient error — tried again next tick, nothing alarming to show
        .then((data: { strategies?: StrategyRecord[] } | null) => !cancelled && data && setAll(deriveNotifications(data.strategies ?? [])))
        .catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, wallet]);

  const markAllRead = useCallback(() => {
    if (!wallet) return;
    const newest = all.reduce((m, n) => Math.max(m, n.at), 0);
    const next = Math.max(lastSeenAt, newest, Date.now());
    setLastSeenAt(next);
    try {
      localStorage.setItem(seenKey(wallet), String(next));
    } catch {}
  }, [wallet, all, lastSeenAt]);

  return { notifications: all, unreadCount: countUnread(all, lastSeenAt), markAllRead };
}
