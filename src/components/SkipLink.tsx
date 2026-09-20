"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** First thing a keyboard or screen-reader user reaches: jumps past the header straight to the page. Invisible until focused. */
export default function SkipLink() {
  const { t } = useLanguage();
  return (
    <a
      href="#main"
      className="fixed left-3 top-3 z-50 -translate-y-24 rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink shadow-lg transition-transform focus:translate-y-0"
    >
      {t("a11y.skip")}
    </a>
  );
}
