"use client";

import { useEffect, useState } from "react";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Summary = { tokensBurned: number; burns: number; recent: { signature: string }[] };

/** 1234567.8 -> "1.23M": a count of tokens, never a dollar amount. */
export function tokenCount(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(n);
}

/**
 * "🔥 Burned: X tokens" on a coin's page: what PANDA's burn wallet has bought with this coin's Burn share and burned
 * (src/lib/burn). A fact, with the latest burn's transaction behind it — nothing about price. Shown only for a coin
 * that has had a burn, and only while FEATURE_BURN is on.
 */
export default function BurnedLine({ mint, className = "" }: { mint: string; className?: string }) {
  const { burn } = useFeatures();
  const { t, lang } = useLanguage();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!burn) return;
    let cancelled = false;
    fetch(`/api/burn/summary?mint=${mint}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => !cancelled && setSummary(d && d.tokensBurned > 0 ? d : null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [burn, mint]);

  if (!burn || !summary) return null;
  const latest = summary.recent[0]?.signature;
  const text = t("burn.line", { amount: tokenCount(summary.tokensBurned, lang) });
  const pill = "inline-flex min-h-8 items-center rounded-full bg-clay-red/10 px-3 text-xs font-semibold text-clay-red";
  return latest ? (
    <a href={`https://solscan.io/tx/${latest}`} target="_blank" rel="noreferrer" title={t("burn.lineTitle")} className={`${pill} transition hover:bg-clay-red/15 ${className}`}>
      {text}
    </a>
  ) : (
    <span className={`${pill} ${className}`}>{text}</span>
  );
}
