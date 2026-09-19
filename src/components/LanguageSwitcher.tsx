"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-paper/15 p-0.5 text-xs font-semibold">
      <button
        onClick={() => setLang("en")}
        aria-label="English"
        className={`rounded-full px-2 py-1 transition-colors ${lang === "en" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("es")}
        aria-label="Español"
        className={`rounded-full px-2 py-1 transition-colors ${lang === "es" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
      >
        ES
      </button>
    </div>
  );
}
