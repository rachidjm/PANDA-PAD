"use client";

import { motion } from "framer-motion";
import CoinCard from "@/components/CoinCard";
import { Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

/** Renders nothing when there are no real coins for this section — never
 * padded with placeholders just to avoid an empty look. */
export default function HomeSection({ titleKey, coins }: { titleKey: DictKey; coins: Coin[] }) {
  const { t } = useLanguage();
  if (coins.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="mb-10"
    >
      <div className="mb-4 flex items-baseline gap-2.5">
        <h2 className="font-display text-xl font-bold">{t(titleKey)}</h2>
        <span className="text-xs text-panda-grey">{coins.length}</span>
      </div>
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        variants={gridVariants}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {coins.map((coin) => (
          <motion.div key={coin.mint} variants={cardVariants}>
            <CoinCard coin={coin} />
          </motion.div>
        ))}
      </motion.div>
    </motion.section>
  );
}
