"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { formatPrice, formatRelativeTime } from "@/lib/format";
import type { DictKey } from "@/lib/i18n/translations";
import { useStrategyNotifications } from "./useStrategyNotifications";
import type { NotificationKind } from "@/lib/strategy/notifications";

const TEXT_KEY: Record<NotificationKind, DictKey> = {
  buy: "notif.buyFilled",
  sell: "notif.sellFilled",
  panda_sell: "notif.pandaSell",
  panda_stop: "notif.pandaStop",
  panda_resign: "notif.pandaResign",
  panda_slippage: "notif.pandaSlippage",
  panda_no_sol: "notif.pandaNoSol",
};

/** The header bell: a history of Draw Your Trade's own executed legs, nothing more — no Web Push, it only
 *  ever shows what's already on screen when the wallet opens the app (or the next time the list is polled
 *  while it's open). Only shown with a connected wallet and the feature on: with neither, there is nothing to
 *  show and nowhere safe to ask the server for it. */
export default function NotificationBell() {
  const { t, lang } = useLanguage();
  const { strategies, pandaOrders } = useFeatures();
  const { connected } = useWallet();
  const { notifications, unreadCount, markAllRead } = useStrategyNotifications({ strategies: strategies && connected, pandaOrders: pandaOrders && connected });
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

  if ((!strategies && !pandaOrders) || !connected) return null;

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
        // Phone: a panel as wide as the screen, right under the header (the header is what `fixed` is measured from —
        // its blur makes it the containing block — so the panel can never hang off the left edge as a 320px box
        // anchored to the bell did). Desktop: the same small dropdown under the bell as before.
        <div
          role="dialog"
          aria-label={t("notif.title")}
          className="fixed inset-x-3 top-[calc(var(--header-h,64px)+0.5rem)] z-50 flex max-h-[calc(100dvh-var(--header-h,64px)-6rem)] flex-col overflow-hidden rounded-2xl border border-paper/10 bg-ink-raised shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-80"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-paper/10 py-1 pl-4 pr-1.5">
            <p className="text-sm font-bold">{t("notif.title")}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("notif.close")} className="flex h-10 w-10 items-center justify-center rounded-full text-panda-grey transition-colors hover:bg-paper/10 hover:text-paper">
              <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-panda-grey">{t("notif.empty")}</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-96">
              {notifications.slice(0, 30).map((n) => (
                <li key={n.id} className="border-b border-paper/5 last:border-b-0">
                  <Link href={`/coin/${n.mint}`} onClick={() => setOpen(false)} className="block px-4 py-3 text-sm transition-colors hover:bg-paper/5 sm:text-xs">
                    <p className="text-paper/90">{t(TEXT_KEY[n.kind], { ticker: n.ticker, price: formatPrice(n.priceUsd), reason: n.reason ? t(`orders.reason.${n.reason}` as DictKey) : "" })}</p>
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
