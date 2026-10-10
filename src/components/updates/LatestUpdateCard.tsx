"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatDay } from "./UpdatesClient";
import { useLatestUpdate } from "./useLatestUpdate";

/** The home page's small card under the banner: the newest update's title and day, and the way to all of them.
 *  Nothing is rendered while there is no update (or it couldn't be read) — never an empty box. */
export default function LatestUpdateCard() {
  const { t, lang } = useLanguage();
  const { latest, unseen } = useLatestUpdate();
  if (!latest) return null;
  return (
    <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-paper/10 bg-ink-raised px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-paper/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-paper/80">
          {unseen && <span className="h-1.5 w-1.5 rounded-full bg-meme-orange" aria-hidden />}
          {t("nav.updates")}
        </span>
        <Link href={`/updates/${latest.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold transition-colors hover:text-meme-orange">
          {latest.title[lang] ?? latest.title.en}
        </Link>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 text-xs sm:justify-end">
        <time dateTime={new Date(latest.ts).toISOString().slice(0, 10)} className="text-panda-grey">
          {formatDay(latest.ts, lang)}
        </time>
        <Link href="/updates" className="font-semibold text-paper/80 transition-colors hover:text-paper">
          {t("updates.seeAll")} →
        </Link>
      </div>
    </div>
  );
}
