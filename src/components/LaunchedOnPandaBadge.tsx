"use client";

import Logo from "@/components/Logo";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * "Launched on PANDA" — dark background, a thin lime border, the real PANDA logo (no emoji). Two sizes:
 *   pill      the coin page header, next to RugBadge's own "pill" variant — same height, radius and
 *             typography as that badge so the two sit aligned and visually consistent.
 *   compact   a card's corner overlay, over the coin's own image — small and blurred for legibility
 *             against any image behind it, matching the card's other corner badges (RugCheck, Verified).
 */
export default function LaunchedOnPandaBadge({ size = "pill", className = "" }: { size?: "pill" | "compact"; className?: string }) {
  const { t } = useLanguage();
  const label = t("coinCard.launchedOnPanda");

  if (size === "compact") {
    return (
      <span
        title={label}
        className={`inline-flex items-center gap-1 rounded-full border border-bamboo/50 bg-ink/75 px-1.5 py-0.5 text-[9px] font-semibold text-paper backdrop-blur sm:px-2 sm:text-[11px] ${className}`}
      >
        <Logo size={10} />
        {label}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-bamboo/50 bg-ink/75 px-2.5 py-1 text-xs font-semibold text-paper ${className}`}>
      <Logo size={14} />
      {label}
    </span>
  );
}
