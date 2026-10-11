"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import InfoTooltip from "./InfoTooltip";

type Cost = { firstBuy: number; pandaFee: number; network: number; total: number };

/**
 * What launching takes from the wallet, line by line (src/lib/pump/launch-info.ts, launchCost): the first buy, PANDA's
 * trade fee on it, the coin's accounts on Solana with the network fees, and Pump.fun's creation fee — which is nothing.
 * The first two are exact; the accounts-and-network line is the measured figure, so the total carries "≈".
 */
export default function CostSummary({ cost, feeBps }: { cost: Cost; feeBps: number }) {
  const { t, lang } = useLanguage();
  const sol = (n: number) => `${n.toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`;
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cr.cost.title")}</span>
      <dl className="rounded-2xl bg-ink px-4 py-1.5 text-sm">
        <Line label={t("cr.cost.firstBuy")} value={cost.firstBuy > 0 ? sol(cost.firstBuy) : "—"} />
        <Line label={t("cr.cost.pandaFee", { pct: (feeBps / 100).toLocaleString(lang) })} tooltip={t("cr.cost.pandaFeeInfo")} value={cost.firstBuy > 0 ? sol(cost.pandaFee) : "—"} />
        <Line label={t("cr.cost.network")} tooltip={t("cr.cost.networkInfo")} value={`≈ ${sol(cost.network)}`} />
        <Line label={t("cr.cost.pump")} tooltip={t("cr.cost.pumpInfo")} value={sol(0)} />
        <div className="flex items-center justify-between gap-3 border-t border-paper/10 py-3">
          <dt className="font-semibold">{t("cr.cost.total")}</dt>
          <dd className="font-display text-base font-bold" aria-live="polite">
            ≈ {sol(cost.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Line({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="min-w-0 text-paper/75">
        {label}
        {tooltip && (
          <span className="ml-1.5 inline-flex align-middle">
            <InfoTooltip text={tooltip} align="start" />
          </span>
        )}
      </dt>
      <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
