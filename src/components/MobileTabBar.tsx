"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

/**
 * The phone's main navigation: the five places people go most, at thumb height (spec §28). Everything else
 * (Themes, Analytics, Activity…) stays in the compact row under the header. Hidden from `sm` up, where the
 * header navigation is used.
 */

type Item = { href: string; label: DictKey; icon: React.ReactNode };

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const ITEMS: Item[] = [
  { href: "/", label: "nav.home", icon: svg("M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10") },
  { href: "/discover", label: "nav.discover", icon: svg("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z") },
  { href: "/create", label: "nav.create", icon: svg("M12 5v14M5 12h14") },
  { href: "/rewards", label: "nav.rewards", icon: svg("M4 9h16v4H4zM12 9v11M6 13v7h12v-7M8.5 9C7 9 6 7.5 7 6.3S10 5.5 12 9c2-3.5 4-3.7 5-2.7S17 9 15.5 9") },
  { href: "/portfolio", label: "nav.portfolio", icon: svg("M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13v-4M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v3H16a2 2 0 0 0 0 4h4") },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <nav aria-label={t("nav.mobile")} className="fixed inset-x-0 bottom-0 z-40 border-t border-paper/10 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map((i) => {
          const active = i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(i.href + "/");
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-0 text-[11px] font-medium tracking-tight transition-colors ${active ? "text-paper" : "text-paper/60 hover:text-paper"}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-paper/10" : ""}`}>{i.icon}</span>
                <span className="whitespace-nowrap">{t(i.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
