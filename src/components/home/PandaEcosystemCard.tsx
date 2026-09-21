"use client";

import { motion } from "framer-motion";
import Logo from "@/components/Logo";
import BuyPandaWidget from "@/components/BuyPandaWidget";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function PandaEcosystemCard() {
  const { t } = useLanguage();
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-paper/10 bg-ink-raised px-5 py-4"
    >
      <div className="flex items-center gap-3">
        <Logo size={36} />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-panda-grey">{t("home.ecosystemLabel")}</p>
          <p className="text-sm font-medium">
            <span className="font-display font-bold">$PANDA</span>{" "}
            <span className="text-panda-grey">{t("home.ecosystemBlurb")}</span>
          </p>
        </div>
      </div>
      <BuyPandaWidget />
    </motion.section>
  );
}
