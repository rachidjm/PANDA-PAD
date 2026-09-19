"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { translate, DictKey, Lang } from "./translations";

const STORAGE_KEY = "panda-lang";

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Runs once on mount, client-only — a saved preference wins, otherwise a
  // Spanish browser locale picks Spanish by default. Never blocks the first
  // paint: the server always renders English, this just switches after.
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "en" || stored === "es") {
          setLangState(stored);
          return;
        }
      } catch {}
      if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es")) {
        setLangState("es");
      }
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}

export type { DictKey, Lang };
