"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { ThemeStatusView } from "./types";

const TONE: Record<ThemeStatusView, string> = {
  ACTIVE: "bg-bamboo/15 text-bamboo",
  SCHEDULED: "bg-meme-orange/15 text-meme-orange",
  CLOSING: "bg-meme-orange/15 text-meme-orange",
  CLOSED: "bg-paper/10 text-paper/60",
  ENDED: "bg-paper/10 text-paper/60",
  ARCHIVED: "bg-paper/10 text-paper/50",
  CANCELLED: "bg-clay-red/15 text-clay-red",
  DRAFT: "bg-paper/10 text-paper/50",
};

export default function StatusPill({ status }: { status: ThemeStatusView }) {
  const { t } = useLanguage();
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[status]}`}>
      {status === "ACTIVE" && <span className="h-1.5 w-1.5 rounded-full bg-bamboo" aria-hidden />}
      {t(`th.status.${status}` as DictKey)}
    </span>
  );
}
