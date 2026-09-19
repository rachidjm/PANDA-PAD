"use client";

import RewardsDashboard from "@/components/rewards/RewardsDashboard";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

const steps: { label: DictKey; detail: DictKey }[] = [
  { label: "rw.step1", detail: "rw.step1d" },
  { label: "rw.step2", detail: "rw.step2d" },
  { label: "rw.step3", detail: "rw.step3d" },
  { label: "rw.step4", detail: "rw.step4d" },
];

export default function RewardsPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-3xl font-bold">{t("rw.title")}</h1>
      <p className="mt-2 max-w-md text-paper/70">{t("rw.intro")}</p>

      <ol className="mt-10 space-y-0">
        {steps.map((step, i) => (
          <li key={step.label} className="relative flex gap-4 pb-8 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px bg-paper/15" aria-hidden />
            )}
            <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-paper/20 bg-ink-raised text-xs font-semibold text-meme-orange">
              {i + 1}
            </span>
            <div className="pt-0.5">
              <p className="font-display font-semibold">{t(step.label)}</p>
              <p className="text-sm text-panda-grey">{t(step.detail)}</p>
            </div>
          </li>
        ))}
      </ol>

      <RewardsDashboard />
    </div>
  );
}
