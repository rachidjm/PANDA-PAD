"use client";

import Image from "next/image";
import Logo from "@/components/Logo";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export type LaunchMode = "standard" | "rewards";

/**
 * The only thing CreateClient.tsx (PANDA Standard, untouched) gives up to make room for PANDA
 * Rewards: which flow to show. Two cards, each fronted by the logo of who runs that launch —
 * PANDA's own for Standard, OTC's for Rewards — so it's clear at a glance whose rails you're on.
 */
export default function LaunchModeToggle({ mode, onChange }: { mode: LaunchMode; onChange: (mode: LaunchMode) => void }) {
  const { t } = useLanguage();
  return (
    <div role="radiogroup" aria-label={t("cr.mode.title")} className="grid gap-3 sm:grid-cols-2">
      <ModeCard
        active={mode === "standard"}
        onClick={() => onChange("standard")}
        logo={<Logo size={34} />}
        title={t("cr.mode.standard")}
        desc={t("cr.mode.standardDesc")}
      />
      <ModeCard
        active={mode === "rewards"}
        onClick={() => onChange("rewards")}
        logo={<Image src="/otc-logo.svg" alt="" width={30} height={30} className="shrink-0" />}
        title={t("cr.mode.rewards")}
        badge="OTC · Meteora"
        desc={t("cr.mode.rewardsDesc")}
      />
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  logo,
  title,
  badge,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  logo: React.ReactNode;
  title: string;
  badge?: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`group relative flex items-start gap-3.5 overflow-hidden rounded-[22px] border p-4 text-left transition-all duration-200 ${
        active
          ? "border-bamboo/70 bg-gradient-to-br from-bamboo/[0.12] via-bamboo/[0.04] to-transparent shadow-[0_0_0_1px_rgba(201,217,76,0.25),0_10px_30px_-12px_rgba(201,217,76,0.35)]"
          : "border-paper/10 bg-ink-raised hover:border-paper/25 hover:bg-paper/[0.03]"
      }`}
    >
      <span
        className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border transition-colors ${
          active ? "border-bamboo/40 bg-ink" : "border-paper/10 bg-ink group-hover:border-paper/25"
        }`}
      >
        {logo}
      </span>
      <span className="min-w-0 flex-1 pr-6">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-display text-base font-bold tracking-tight">{title}</span>
          {badge && <span className="rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-paper/70">{badge}</span>}
        </span>
        <span className="mt-1.5 block text-xs leading-relaxed text-panda-grey">{desc}</span>
      </span>
      <span
        aria-hidden
        className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
          active ? "border-bamboo bg-bamboo text-ink" : "border-paper/20"
        }`}
      >
        {active && (
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.2 5 8.7 9.5 3.5" />
          </svg>
        )}
      </span>
    </button>
  );
}
