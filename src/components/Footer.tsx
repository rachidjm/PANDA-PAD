"use client";

import Link from "next/link";
import Logo from "@/components/Logo";
import { LEGAL_PAGES, LEGAL_SLUGS } from "@/lib/legal-content";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function Footer() {
  const { lang, t } = useLanguage();

  const productLinks = [
    { href: "/discover", label: t("nav.discover") },
    { href: "/create", label: t("nav.create") },
    { href: "/rewards", label: t("nav.rewards") },
    { href: "/analytics", label: t("nav.analytics") },
    { href: "/activity", label: t("act.title") },
  ];

  return (
    <footer className="border-t border-paper/10 bg-ink">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex items-center gap-2">
            <Logo size={26} />
            <span className="font-display text-base font-bold tracking-tight">PANDA</span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-panda-grey">{t("footer.product")}</p>
            <ul className="mt-3 space-y-2">
              {productLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-paper/70 transition-colors hover:text-paper">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-panda-grey">{t("footer.legal")}</p>
            <ul className="mt-3 space-y-2">
              {LEGAL_SLUGS.map((slug) => (
                <li key={slug}>
                  <Link href={`/legal/${slug}`} className="text-sm text-paper/70 transition-colors hover:text-paper">
                    {LEGAL_PAGES[slug].title[lang]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-paper/10 pt-6 text-xs text-panda-grey">{t("footer.disclaimer")}</p>
      </div>
    </footer>
  );
}
