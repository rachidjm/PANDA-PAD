"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const RENEW_EVERY_MS = 30 * 60_000;

/**
 * Keeps the PANDA session in step with the wallet:
 *   - while a wallet is connected and the site is in use (page load, coming back to the tab, every 30 min), asks the
 *     server to renew its session — 7 days for a normal wallet, never for an admin (see /api/auth/renew);
 *   - when the wallet disconnects or another wallet takes its place, the session ends (logout).
 * Renders nothing. A wallet that was never connected on this page (still loading) signs nothing out.
 */
export default function SessionKeeper() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = wallet;
    if (before && before !== wallet) fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (!wallet) return;
    const renew = () =>
      fetch("/api/auth/renew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) }).catch(() => {});
    // Right after a switch, the logout above runs first; the renewal then finds no session and does nothing.
    const first = setTimeout(renew, before && before !== wallet ? 1500 : 0);
    const timer = setInterval(renew, RENEW_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && renew();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wallet]);

  return null;
}
