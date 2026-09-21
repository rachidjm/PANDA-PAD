"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletButton from "@/components/WalletButton";
import Logo from "@/components/Logo";
import CoinSearchBox from "@/components/CoinSearchBox";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function Navbar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { themes } = useFeatures();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Desktop: the places people go. Themes only when the feature is on.
  const links = [
    { href: "/discover", label: t("nav.discover") },
    { href: "/create", label: t("nav.create") },
    ...(themes ? [{ href: "/themes", label: t("nav.themes") }] : []),
    { href: "/rewards", label: t("nav.rewards") },
    { href: "/analytics", label: t("nav.analytics") },
  ];

  // Phone: Home / Discover / Create / Rewards / Portfolio live in the bottom bar; the rest is here, short enough not to scroll.
  const more = [...(themes ? [{ href: "/themes", label: t("nav.themes") }] : []), { href: "/analytics", label: t("nav.analytics") }, { href: "/activity", label: t("act.title") }];

  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="PANDA">
          <Logo size={34} />
          <span className="font-display text-lg font-bold tracking-tight">PANDA</span>
        </Link>

        <nav aria-label={t("nav.primary")} className="hidden items-center gap-1 sm:flex">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-paper/10 text-paper" : "text-paper/60 hover:text-paper"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:block">
            <CoinSearchBox />
          </div>
          <LanguageSwitcher />
          <WalletButton />
        </div>
      </div>

      <nav aria-label={t("nav.more")} className="flex items-center gap-1 border-t border-paper/10 px-4 py-1.5 sm:hidden">
        {more.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm ${isActive(l.href) ? "bg-paper/10 text-paper" : "text-paper/70 hover:text-paper"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
