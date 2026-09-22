"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export type LaunchMode = "standard" | "rewards";

/**
 * The only thing CreateClient.tsx (PANDA Standard, untouched) gives up to make room for PANDA
 * Rewards: which flow to show. Styled like the rest of Create's own controls (see FeeDistributionStep's
 * rows) — a native PANDA choice, not an OTC-branded widget bolted on.
 */
export default function LaunchModeToggle({ mode, onChange }: { mode: LaunchMode; onChange: (mode: LaunchMode) => void }) {
  const { t } = useLanguage();
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cr.mode.title")}</span>
      <div className="grid grid-cols-2 gap-2">
        <ModeCard
          active={mode === "standard"}
          onClick={() => onChange("standard")}
          title={t("cr.mode.standard")}
          desc={t("cr.mode.standardDesc")}
        />
        <ModeCard
          active={mode === "rewards"}
          onClick={() => onChange("rewards")}
          title={t("cr.mode.rewards")}
          desc={t("cr.mode.rewardsDesc")}
        />
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-2xl border px-4 py-3.5 text-left transition-colors ${
        active ? "border-bamboo bg-bamboo/10" : "border-paper/15 bg-ink-raised hover:border-paper/30"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-bamboo" : "bg-paper/25"}`} aria-hidden />
        {title}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-panda-grey">{desc}</span>
    </button>
  );
}
