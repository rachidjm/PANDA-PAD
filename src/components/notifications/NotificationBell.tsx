"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/translations";
import { useStrategyNotifications } from "./useStrategyNotifications";

const TEXT_KEY: Record<"buy" | "sell", DictKey> = { buy: "notif.buyFilled", sell: "notif.sellFilled" };

/** The header bell: a history of Draw Your Trade's own executed legs, nothing more — no Web Push, it only
 *  ever shows what's already on screen when the wallet opens the app (or the next time the list is polled
 *  while it's open). Only shown with a connected wallet and the feature on: with neither, there is nothing to
 *  show and nowhere safe to ask the server for it. */
export default function NotificationBell() {
  const { t, lang } = useLanguage();
  const { strategies } = useFeatures();
  const { connected } = useWallet();
  const { notifications, unreadCount, markAllRead } = useStrategyNotifications(strategies && connected);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!strategies || !connected) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markAllRead();
        }}
        aria-label={unreadCount > 0 ? t("notif.bellUnread", { n: unreadCount }) : t("notif.bell")}
        aria-expanded={open}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper"
      >
        <BellIcon />
        {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-clay-red" aria-hidden />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-paper/10 bg-ink-raised shadow-xl">
          <p className="border-b border-paper/10 px-4 py-3 text-sm font-bold">{t("notif.title")}</p>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-panda-grey">{t("notif.empty")}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.slice(0, 30).map((n) => (
                <li key={n.id} className="border-b border-paper/5 last:border-b-0">
                  <Link href={`/coin/${n.mint}`} onClick={() => setOpen(false)} className="block px-4 py-3 text-xs transition-colors hover:bg-paper/5">
                    <p className="text-paper/90">{t(TEXT_KEY[n.kind], { ticker: n.ticker, price: formatPrice(n.priceUsd) })}</p>
                    <p className="mt-0.5 text-panda-grey">{formatRelativeTime(n.at, lang)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 8a5 5 0 0 1 10 0c0 3.2 1 4.5 1.5 5.2a.6.6 0 0 1-.5 1H4a.6.6 0 0 1-.5-1C4 12.5 5 11.2 5 8Z" />
      <path d="M8 16.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
