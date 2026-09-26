"use client";

import Link from "next/link";
import { LEGAL_PAGES, LEGAL_SLUGS, LegalPage } from "@/lib/legal-content";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LegalPageLayout({ page }: { page: LegalPage }) {
  const { lang, t } = useLanguage();
  // Fixed formatting in UTC, so the server and the browser print the same day.
  const updated = new Date(`${page.updated}T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <nav className="mb-8 flex flex-wrap gap-1.5">
        {LEGAL_SLUGS.map((slug) => {
          const active = slug === page.slug;
          return (
            <Link
              key={slug}
              href={`/legal/${slug}`}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-paper/10 text-paper" : "text-paper/50 hover:text-paper/80"
              }`}
            >
              {LEGAL_PAGES[slug].title[lang]}
            </Link>
          );
        })}
      </nav>

      <h1 className="font-display text-2xl font-bold">{page.title[lang]}</h1>
      <p className="mt-1 text-xs text-panda-grey">
        {t("legal.updated")}: <time dateTime={page.updated}>{updated}</time>
      </p>
      <div className="mt-5 space-y-4">
        {page.body[lang].map((paragraph, i) => (
          <p key={i} className={`text-sm leading-relaxed ${i === 0 ? "text-clay-red" : "text-panda-grey"}`}>
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
