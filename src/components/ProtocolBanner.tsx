"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

type PausedItem = { subsystem: string; reason: string; since: number };

const LABEL_KEYS: Record<string, DictKey> = {
  claims: "pause.claims",
  airdrops: "pause.airdrops",
  nft_minting: "pause.nft_minting",
  nft_market: "pause.nft_market",
  token_launches: "pause.token_launches",
  reward_calculations: "pause.reward_calculations",
  fee_processing: "pause.fee_processing",
};

/** Shown only while a protocol subsystem is paused; renders nothing otherwise. Status is read from the server, never assumed. */
export default function ProtocolBanner() {
  const { t } = useLanguage();
  const [paused, setPaused] = useState<PausedItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/protocol/status")
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && Array.isArray(d.paused)) setPaused(d.paused);
        })
        .catch(() => {});
    Promise.resolve().then(load);
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (paused.length === 0) return null;

  return (
    <div role="status" className="border-b border-clay-red/30 bg-clay-red/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
        <span className="font-display text-xs font-bold uppercase tracking-widest text-clay-red">{t("pause.title")}</span>
        <span className="text-paper/70">
          {paused.map((p, i) => {
            const key = LABEL_KEYS[p.subsystem];
            return (
              <span key={p.subsystem}>
                {i > 0 && " · "}
                {key ? t(key) : p.subsystem}
                {p.reason ? ` — ${p.reason}` : ""}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
