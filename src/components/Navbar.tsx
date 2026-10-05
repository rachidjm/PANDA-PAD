"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import WalletButton from "@/components/WalletButton";
import Logo from "@/components/Logo";
import CoinSearchBox from "@/components/CoinSearchBox";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAIAssistant } from "@/components/ai/AIAssistantProvider";

export default function Navbar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { themes, holderRewards, referrals, aiAssistant } = useFeatures();
  const { show: showAI } = useAIAssistant();

  // Things that stick under the header (the PANDA ecosystem strip) need to know how tall it is: 68px on a desktop, more on a phone with its second row.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Desktop: the places people go. Themes only when the feature is on.
  const links = [
    { href: "/discover", label: t("nav.discover") },
    { href: "/create", label: t("nav.create") },
    ...(themes ? [{ href: "/themes", label: t("nav.themes") }] : []),
    ...(holderRewards ? [{ href: "/rewards", label: t("nav.rewards") }] : []),
    ...(referrals ? [{ href: "/recruiters", label: t("nav.recruiters") }] : []),
    { href: "/analytics", label: t("nav.analytics") },
  ];

  // Phone: Home / Discover / Create / Rewards / Portfolio live in the bottom bar; the rest is here, short enough not to scroll.
  const more = [
    ...(themes ? [{ href: "/themes", label: t("nav.themes") }] : []),
    ...(referrals ? [{ href: "/recruiters", label: t("nav.recruiters") }] : []),
    { href: "/analytics", label: t("nav.analytics") },
    { href: "/activity", label: t("act.title") },
  ];

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-paper/10 bg-ink/90 backdrop-blur">
      {/* Same max-width + side padding as the page content below (src/app/page.tsx) — at desktop widths beyond
          sm, this keeps the logo flush with the cards' left edge and the wallet flush with the sidebar's right
          edge, instead of the header centering itself in a narrower column than the content it sits above. */}
      <div className="mx-auto flex max-w-[1680px] items-center gap-6 px-5 py-3.5 2xl:gap-8 2xl:py-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="PANDA">
          <Logo size={34} className="2xl:h-10 2xl:w-10" />
          <span className="font-display text-lg font-bold tracking-tight 2xl:text-xl">PANDA</span>
        </Link>

        <nav aria-label={t("nav.primary")} className="hidden items-center gap-1 sm:flex 2xl:gap-1.5">
          {links.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors 2xl:px-4 2xl:py-2 2xl:text-base ${active ? "bg-paper/10 text-paper" : "text-paper/60 hover:text-paper"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3 2xl:gap-4">
          <div className="hidden md:block">
            <CoinSearchBox />
          </div>
          {aiAssistant && (
            <button
              type="button"
              onClick={() => showAI()}
              className="hidden shrink-0 items-center gap-1.5 rounded-full border border-meme-orange/40 px-3.5 py-1.5 text-sm font-semibold text-paper transition-colors hover:border-meme-orange sm:flex 2xl:px-4 2xl:py-2 2xl:text-base"
            >
              <span aria-hidden>✨</span>
              {t("ai.modeButton")}
            </button>
          )}
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
