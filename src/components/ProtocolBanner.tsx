"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { useFeatures, type Features } from "@/components/providers/FeaturesProvider";

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

const NET_KEYS: Record<string, DictKey> = {
  network_mismatch: "net.banner.network_mismatch",
  network_not_configured: "net.banner.network_not_configured",
  network_unverified: "net.banner.network_unverified",
  env_missing: "net.banner.env_missing",
};

/** Which feature a pause switch belongs to: a pause of a feature that is switched off on this deployment is not announced (there is nothing to pause). */
const FEATURE_OF: Record<string, keyof Features | undefined> = {
  claims: "holderRewards",
  reward_calculations: "holderRewards",
  fee_processing: "holderRewards",
  airdrops: "airdrops",
  nft_minting: "themes",
  nft_market: "market",
};

/** Shown only while a protocol subsystem is paused; renders nothing otherwise. Status is read from the server, never assumed. */
export default function ProtocolBanner() {
  const { t } = useLanguage();
  const features = useFeatures();
  const [allPaused, setPaused] = useState<PausedItem[]>([]);
  const paused = allPaused.filter((p) => {
    const f = FEATURE_OF[p.subsystem];
    return !f || features[f];
  });
  // The network guard: why money flows are blocked (null when they are allowed).
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/protocol/status")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (Array.isArray(d.paused)) setPaused(d.paused);
          setBlockedReason(d.moneyFlows && d.moneyFlows.allowed === false ? String(d.moneyFlows.reason || "env_missing") : null);
        })
        .catch(() => {});
    Promise.resolve().then(load);
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (paused.length === 0 && !blockedReason) return null;

  if (blockedReason && paused.length === 0) {
    const key = NET_KEYS[blockedReason] ?? NET_KEYS.env_missing;
    return (
      <div role="alert" className="border-b border-clay-red/30 bg-clay-red/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
          <span className="font-display text-xs font-bold uppercase tracking-widest text-clay-red">{t("net.banner.title")}</span>
          <span className="text-paper/70">{t(key)}</span>
        </div>
      </div>
    );
  }

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
