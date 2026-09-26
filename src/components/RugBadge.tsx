"use client";

import { useEffect, useRef, useState } from "react";
import { useRugSummary } from "@/lib/rugcheck/client";
import { rugcheckPageUrl, type RugLevel } from "@/lib/rugcheck/summary";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const TONE: Record<RugLevel, { dot: string; pill: string }> = {
  good: { dot: "bg-bamboo", pill: "bg-bamboo/15 text-bamboo" },
  warn: { dot: "bg-sun", pill: "bg-sun/15 text-sun" },
  danger: { dot: "bg-clay-red", pill: "bg-clay-red/15 text-clay-red" },
};
const LABEL = { good: "rc.good", warn: "rc.warn", danger: "rc.danger" } as const;

/**
 * RugCheck's risk level for a coin (third party, automated — see src/lib/rugcheck/summary.ts). Shows NOTHING until RugCheck has really
 * answered, and nothing if it can't: there is no "loading" or "unknown" badge to mislead. On a card it asks only once it scrolls into view.
 *   compact  the small pill for cards: a dot and RugCheck's score.
 *   full     the coin page: the level in words, the score, the first risks it flagged and a link to RugCheck's own page.
 */
export default function RugBadge({ mint, variant = "compact", className = "" }: { mint: string; variant?: "compact" | "full"; className?: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(variant === "full");

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && (setVisible(true), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const summary = useRugSummary(mint, visible);
  if (!summary) {
    // Nothing to show (yet): no placeholder. The card keeps a 1px invisible anchor (NOT display:none, which can't be observed) so it can ask when it scrolls into view.
    return variant === "compact" ? <span ref={ref} className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0" aria-hidden /> : null;
  }

  const tone = TONE[summary.level];
  const title = t("rc.title", { n: summary.score ?? "—" });
  if (variant === "compact") {
    return (
      <span title={title} aria-label={`${t(LABEL[summary.level])}${summary.score !== null ? ` ${summary.score}` : ""}`} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur sm:px-2 sm:text-[11px] ${tone.pill} ${className}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
        {summary.score !== null ? summary.score : t(LABEL[summary.level])}
      </span>
    );
  }
  return (
    <div className={`rounded-2xl border border-paper/10 bg-ink-raised p-3.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.pill}`}>
          <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
          RugCheck · {t(LABEL[summary.level])}
          {summary.score !== null && <span className="opacity-80">· {summary.score}/100</span>}
        </span>
        <a href={rugcheckPageUrl(mint)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-meme-orange hover:brightness-110">
          {t("rc.view")} ↗
        </a>
      </div>
      {summary.risks.length > 0 && (
        <ul className="mt-2.5 space-y-1 text-xs text-paper/75">
          {summary.risks.slice(0, 3).map((r) => (
            <li key={r.name} className="flex items-start gap-1.5">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${r.level === "danger" ? "bg-clay-red" : r.level === "warn" ? "bg-sun" : "bg-panda-grey"}`} aria-hidden />
              {r.name}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-[11px] leading-snug text-panda-grey">{t("rc.disclaimer")}</p>
    </div>
  );
}
