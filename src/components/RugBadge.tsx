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
 *   pill     the coin page header: "RugCheck 1/100" — the level, top risks and disclaimer live in the hover/tap tooltip, not a big box.
 *   full     a page with no chart/trading of its own (TokenNoMarket): the level in words, the score, the first risks and a link to RugCheck's own page.
 */
export default function RugBadge({ mint, variant = "compact", className = "" }: { mint: string; variant?: "compact" | "full" | "pill"; className?: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(variant !== "compact");
  // Mobile has no hover, so the (i) icon toggles the same tooltip text instead — off by default,
  // and closed again on a second tap or a tap elsewhere.
  const [mobileTipOpen, setMobileTipOpen] = useState(false);

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
  // Same disclaimer wording everywhere RugCheck shows up (compact/pill tooltips, the full-page card) —
  // never mixed with the old per-score "RugCheck risk score: N..." phrasing, so it reads identically in
  // every spot a user might see it, in both languages.
  const disclaimer = t("rc.disclaimer");
  const levelLabel = t(LABEL[summary.level]);
  if (variant === "compact") {
    // No `relative` on this element on purpose: the caller's own className (CoinCard.tsx) is what positions
    // this badge with `absolute` over the card's image — `position: absolute` already establishes the
    // containing block the tooltip below needs, and Tailwind's core plugin order would otherwise have a
    // same-element `relative` win over that `absolute` (relative is defined after absolute in its generated
    // CSS), silently breaking the overlay position.
    // Dark, semi-opaque + blurred, with a thin border and light text — not the tone's own tinted
    // background: a badge over a coin's own image has to stay legible against ANY image behind it
    // (a lime-green coin on a lime "good" badge would nearly disappear), so only the dot carries the
    // level's color here. The tone.pill coloring is still used by the "pill"/"full" variants below,
    // which never sit on top of an image.
    return (
      <span aria-label={`${levelLabel}${summary.score !== null ? ` ${summary.score}/100` : ""} — ${disclaimer}`} className={`group/rug inline-flex items-center gap-1 rounded-full border border-paper/20 bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-paper backdrop-blur sm:px-2 sm:text-[11px] ${className}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
        {summary.score !== null ? `${summary.score}/100` : levelLabel}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMobileTipOpen((v) => !v);
          }}
          aria-label={disclaimer}
          className="-my-0.5 -mr-0.5 ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold opacity-80 sm:hidden"
        >
          i
        </button>
        {/* Desktop: hover tooltip, no native `title` alongside it (that was showing the browser's own
            tooltip AND this one at once). Mobile: the same box, toggled by the (i) button instead of hover.
            Left-aligned, not centered: the badge sits at the card's own left edge, so a centered tooltip
            would overflow past it and get clipped by the image's overflow-hidden. */}
        <span
          className={`pointer-events-none absolute left-0 top-full z-20 mt-1 w-max max-w-[200px] rounded-lg bg-ink px-2 py-1 text-[10px] font-medium normal-case leading-snug text-paper opacity-0 shadow-lg transition-opacity group-hover/rug:sm:opacity-100 ${mobileTipOpen ? "opacity-100" : ""}`}
        >
          {disclaimer}
        </span>
      </span>
    );
  }
  if (variant === "pill") {
    const risksText = summary.risks.slice(0, 3).map((r) => r.name).join(", ");
    return (
      <span aria-label={`${levelLabel}${risksText ? ` (${risksText})` : ""} — ${disclaimer}`} className={`group/rug relative inline-block ${className}`}>
        <a
          href={rugcheckPageUrl(mint)}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors hover:brightness-110 ${tone.pill}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
          RugCheck {summary.score !== null ? `${summary.score}/100` : levelLabel}
        </a>
        <span
          className={`pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[260px] -translate-x-0 rounded-xl border border-paper/10 bg-ink px-3 py-2 text-xs leading-relaxed text-paper/85 opacity-0 shadow-xl transition-opacity group-hover/rug:block group-hover/rug:opacity-100 ${mobileTipOpen ? "!block !opacity-100" : ""}`}
        >
          <span className="font-semibold text-paper">
            {levelLabel}
            {risksText && ` · ${risksText}`}
          </span>
          <span className="mt-1 block text-panda-grey">{disclaimer}</span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMobileTipOpen((v) => !v);
          }}
          aria-label={disclaimer}
          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-paper/20 align-middle text-[9px] font-bold text-paper/60 sm:hidden"
        >
          i
        </button>
      </span>
    );
  }
  return (
    <div className={`rounded-2xl border border-paper/10 bg-ink-raised p-3.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span aria-label={`${levelLabel} — ${disclaimer}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.pill}`}>
          <span className={`h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
          RugCheck · {levelLabel}
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
      <p className="mt-2.5 text-[11px] leading-snug text-panda-grey">{disclaimer}</p>
    </div>
  );
}
