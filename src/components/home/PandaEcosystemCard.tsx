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
      className="relative flex h-12 items-center justify-between gap-3 rounded-2xl border border-paper/10 bg-ink-raised px-3 shadow-[0_6px_20px_rgba(0,0,0,0.35)] sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Logo size={28} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-panda-grey">{t("home.ecosystemLabel")}</p>
          <p className="truncate text-sm font-medium">
            <span className="font-display font-bold">$PANDA</span>
            <span className="hidden text-panda-grey sm:inline"> {t("home.ecosystemBlurb")}</span>
          </p>
        </div>
      </div>
      <BuyPandaWidget />
    </motion.section>
  );
}
