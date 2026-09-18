"use client";

import { motion } from "framer-motion";
import Panda from "@/components/panda/Panda";
import BuyPandaWidget from "@/components/BuyPandaWidget";

export default function PandaEcosystemCard() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-paper/10 bg-ink-raised px-5 py-4"
    >
      <div className="flex items-center gap-3">
        <Panda mark size={36} />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-panda-grey">PANDA ecosystem</p>
          <p className="text-sm font-medium">
            <span className="font-display font-bold">$PANDA</span>{" "}
            <span className="text-panda-grey">— the token powering the ecosystem</span>
          </p>
        </div>
      </div>
      <BuyPandaWidget />
    </motion.section>
  );
}
