"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletButton from "@/components/WalletButton";
import Panda from "@/components/panda/Panda";
import CoinSearchBox from "@/components/CoinSearchBox";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function Navbar({ showThemes = false }: { showThemes?: boolean }) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const links = [
    { href: "/discover", label: t("nav.discover") },
    { href: "/create", label: t("nav.create") },
    ...(showThemes ? [{ href: "/themes", label: t("nav.themes") }] : []),
    { href: "/rewards", label: t("nav.rewards") },
    { href: "/analytics", label: t("nav.analytics") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Panda mark size={30} />
          <span className="font-display text-lg font-bold tracking-tight">PANDA</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-paper/10 text-paper" : "text-paper/60 hover:text-paper"
                }`}
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

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-paper/10 px-5 py-2 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="shrink-0 rounded-full px-3 py-1 text-sm text-paper/70 hover:text-paper"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
