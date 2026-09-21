"use client";

import Link from "next/link";
import Panda from "@/components/panda/Panda";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function Hero() {
  const { t } = useLanguage();
  // On a phone the page opens straight on the coins (the tab bar already has Create and Discover); the heading stays for screen readers.
  return (
    <>
    <h1 className="sr-only sm:hidden">
      {t("home.title1")} {t("home.title2")}
    </h1>
    <section className="hidden grid-cols-1 items-center gap-10 py-16 sm:grid md:grid-cols-[1.1fr_1fr]">
      <div>
        <p className="font-display text-base font-semibold text-paper/70">{t("home.kicker")}</p>
        <h1 className="mt-3 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
          {t("home.title1")}
          <br />
          {t("home.title2")}
        </h1>
        <p className="mt-5 max-w-sm text-lg text-paper/70">{t("home.subtitle")}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/create"
            className="rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink hover:brightness-90 transition"
          >
            {t("home.createCta")}
          </Link>
          <Link
            href="/discover"
            className="rounded-full border border-paper/20 px-6 py-3 text-sm font-semibold text-paper hover:border-paper/40 transition"
          >
            {t("home.exploreCta")}
          </Link>
        </div>
      </div>

      <div className="flex justify-center md:justify-end">
        <Panda
          pose="idle"
          size={280}
          interactive
          className="h-[170px] w-[170px] drop-shadow-[0_20px_40px_rgba(0,0,0,0.35)] sm:h-[280px] sm:w-[280px]"
        />
      </div>
    </section>
    </>
  );
}
