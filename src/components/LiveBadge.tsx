"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LiveBadge({ live }: { live: boolean }) {
  const { t } = useLanguage();
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        live ? "bg-bamboo/15 text-bamboo" : "bg-panda-grey/15 text-panda-grey"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-bamboo" : "bg-panda-grey"}`} />
      <span className="hidden sm:inline">{live ? t("live.live") : t("live.demo")}</span>
      <span className="sm:hidden">{live ? t("live.short") : t("live.demo")}</span>
    </span>
  );
}
