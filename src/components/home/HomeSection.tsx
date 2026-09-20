"use client";

import { motion } from "framer-motion";
import CoinCard from "@/components/CoinCard";
import { Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

/** Renders nothing when there are no real coins for this section — never
 * padded with placeholders just to avoid an empty look. */
export default function HomeSection({ titleKey, coins }: { titleKey: DictKey; coins: Coin[] }) {
  const { t } = useLanguage();
  if (coins.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-10"
    >
      <div className="mb-4 flex items-baseline gap-2.5">
        <h2 className="font-display text-xl font-bold">{t(titleKey)}</h2>
        <span className="text-xs text-panda-grey">{coins.length}</span>
      </div>
      {/* Each card animates itself when it mounts. They deliberately do NOT inherit a parent variant:
          a card that mounts after a Refresh (new coin) would otherwise miss the parent's "show"
          transition and stay at opacity 0 — invisible but still clickable. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {coins.map((coin, i) => (
          <motion.div
            key={coin.mint}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut", delay: Math.min(i, 8) * 0.04 }}
          >
            <CoinCard coin={coin} />
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
