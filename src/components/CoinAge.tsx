"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { CoinSource } from "@/lib/types";

/**
 * Live "time since created" label that keeps ticking. `createdAt` is the
 * pool's creation time: for a Pump.fun bonding-curve coin that IS its launch,
 * but for a coin that has graduated to PumpSwap it's the moment its AMM pool
 * was created — so those are labelled "Grad." rather than passed off as the
 * coin's birth.
 */
export default function CoinAge({
  createdAt,
  source,
  verified,
  className = "",
}: {
  createdAt: string;
  source?: CoinSource;
  /** True when `createdAt` is the coin's real Pump.fun launch time, so no "Grad." qualifier is needed. */
  verified?: boolean;
  className?: string;
}) {
  const { lang, t } = useLanguage();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.round((now - new Date(createdAt).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "always", style: "narrow" });
  const label =
    seconds < 60
      ? rtf.format(-seconds, "second")
      : seconds < 3600
      ? rtf.format(-Math.floor(seconds / 60), "minute")
      : seconds < 86400
      ? rtf.format(-Math.floor(seconds / 3600), "hour")
      : rtf.format(-Math.floor(seconds / 86400), "day");

  return (
    <span
      className={className}
      title={verified ? t("age.launchedHint") : source === "pumpswap" ? t("age.graduatedHint") : t("age.createdHint")}
    >
      {!verified && source === "pumpswap" ? `${t("age.graduated")} ` : ""}
      {label}
    </span>
  );
}
