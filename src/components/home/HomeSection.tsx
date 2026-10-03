"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import CoinCard from "@/components/CoinCard";
import { Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

/** Below this many, every card fits mobile's own 2-column grid (3 rows) exactly as it always has — the cards
 *  beyond it exist only for the wider desktop tiers (`xl:` and up, see the grid below), hidden here so mobile
 *  is never touched by widening the desktop grid. */
const MOBILE_VISIBLE = 6;

/** Renders nothing when there are no real coins for this section — never
 * padded with placeholders just to avoid an empty look. */
export default function HomeSection({ titleKey, coins, priority = false }: { titleKey: DictKey; coins: Coin[]; priority?: boolean }) {
  const { t } = useLanguage();
  if (coins.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-10"
    >
      <div className="mb-4 flex items-baseline justify-between gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-xl font-bold">{t(titleKey)}</h2>
          <span className="text-xs text-panda-grey">{coins.length}</span>
        </div>
        {/* Desktop only (xl+, where the extra cards below actually live) — mobile already has the one
            "Ver todas" near the top of the page (HomeFeed.tsx), unchanged. */}
        {coins.length > MOBILE_VISIBLE && (
          <Link href="/discover" className="hidden text-sm font-medium text-paper/60 transition-colors hover:text-paper xl:inline">
            {t("home.viewAll")}
          </Link>
        )}
      </div>
      {/* Each card animates itself when it mounts. They deliberately do NOT inherit a parent variant:
          a card that mounts after a Refresh (new coin) would otherwise miss the parent's "show"
          transition and stay at opacity 0 — invisible but still clickable.
          Columns: 2 up to `xl` (unchanged from before — mobile/tablet), then 4 from 1280px, 5 from 1536px,
          6 on very wide screens. The extra cards (beyond MOBILE_VISIBLE) only ever exist at `xl` and up. */}
      {/* `!` on the widest tier: Tailwind v4 doesn't order a custom breakpoint (3xl, added in globals.css)
          strictly after the built-in 2xl in its generated cascade, so without forcing it, 1800px+ screens
          could still get 2xl's 5-column rule instead of this one — verified against the real compiled CSS. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6!">
        {coins.map((coin, i) => (
          <motion.div
            key={coin.mint}
            className={i >= MOBILE_VISIBLE ? "hidden xl:block" : undefined}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut", delay: Math.min(i, 8) * 0.04 }}
          >
            <CoinCard coin={coin} priority={priority && i < 2} />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
