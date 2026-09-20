"use client";

import { useEffect } from "react";
import { BAR_COLOR } from "@/components/create/FeeDistributionStep";
import { FeeLine, formatBps } from "@/lib/pump/fee-plan";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * Last look before the wallet prompt: exactly what is about to be signed —
 * the coin, the full fee split (PANDA's locked 5% included, summing to
 * 100%) and the optional first buy. Nothing happens until "Confirm and sign".
 */
export default function LaunchConfirm({
  name,
  ticker,
  imageSrc,
  lines,
  firstBuySol,
  onBack,
  onConfirm,
}: {
  name: string;
  ticker: string;
  imageSrc: string | null;
  lines: FeeLine[];
  firstBuySol: number;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const total = lines.reduce((sum, l) => sum + l.bps, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const label = (kind: FeeLine["kind"]) =>
    kind === "panda" ? t("fd.protocol") : kind === "creator" ? t("fd.creator") : kind === "holders" ? t("fd.holders") : t("fd.partner");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="launch-confirm-title">
      <div className="w-full max-w-md rounded-[24px] border border-paper/10 bg-ink-raised p-6 shadow-2xl">
        <h2 id="launch-confirm-title" className="font-display text-xl font-bold tracking-tight">
          {t("cr.confirmTitle")}
        </h2>

        <div className="mt-4 flex items-center gap-3">
          {imageSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt="" className="h-12 w-12 rounded-full object-cover" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="text-sm text-panda-grey">${ticker}</p>
          </div>
        </div>

        <div className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-ink" aria-hidden>
          {lines.map((l) => (
            <div key={l.kind} className={`h-full ${BAR_COLOR[l.kind]}`} style={{ width: `${l.bps / 100}%` }} />
          ))}
        </div>

        <ul className="mt-3 space-y-1.5">
          {lines.map((l) => (
            <li key={l.kind} className="flex items-center gap-3 rounded-xl bg-ink px-3.5 py-2.5 text-sm">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR_COLOR[l.kind]}`} aria-hidden />
              <span className="flex-1">
                {label(l.kind)}
                {l.kind === "panda" && (
                  <span className="ml-2 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-paper/70">
                    {t("fd.locked")}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-panda-grey">{short(l.address)}</span>
              <span className="w-14 text-right font-semibold">{formatBps(l.bps)}%</span>
            </li>
          ))}
          <li className="flex items-center justify-between px-3.5 pt-1 text-sm">
            <span className="text-panda-grey">Total</span>
            <span className="font-semibold text-bamboo">{formatBps(total)}%</span>
          </li>
        </ul>

        <div className="mt-3 flex items-center justify-between px-3.5 text-sm">
          <span className="text-panda-grey">{t("cr.confirmFirstBuy")}</span>
          <span className="font-medium">{firstBuySol > 0 ? `${firstBuySol} SOL` : t("cr.confirmNoBuy")}</span>
        </div>

        <p className="mt-4 text-xs text-panda-grey">{t("cr.confirmBody")}</p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-paper/20 py-3 text-sm font-semibold transition-colors hover:border-paper/40"
          >
            {t("cr.confirmBack")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-full bg-paper py-3 text-sm font-semibold text-ink transition hover:brightness-90"
          >
            {t("cr.confirmGo")}
          </button>
        </div>
      </div>
    </div>
  );
}
