"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { SiteUpdate } from "@/lib/db/updates";
import { TAG_LABEL, type UpdateTag } from "@/lib/updates/format";
import { useLatestUpdate } from "./useLatestUpdate";

/**
 * The public Updates page: every update of PANDA, newest first (or oldest first), each with its date, its tag, a short
 * title and a few sentences on what changes for the user — in the site's language. Each entry has its own address, so it
 * can be shared. With `single`, only that one entry is shown (its own page).
 */

const TAG_STYLE: Record<UpdateTag, string> = {
  new: "bg-bamboo/15 text-bamboo",
  improved: "bg-sun/15 text-sun",
  fixed: "bg-paper/10 text-paper/80",
};

export type Order = "newest" | "oldest";

export const formatDay = (ts: number, lang: string) => new Date(ts).toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function CopyLink({ id }: { id: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const url = `${window.location.origin}/updates/${id}`;
        navigator.clipboard
          ?.writeText(url)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => undefined);
      }}
      className="text-xs font-semibold text-panda-grey transition-colors hover:text-paper"
      aria-live="polite"
    >
      {copied ? t("updates.copied") : t("updates.copy")}
    </button>
  );
}

export function UpdateCard({ entry, linked }: { entry: SiteUpdate; linked: boolean }) {
  const { lang } = useLanguage();
  const title = entry.title[lang] ?? entry.title.en;
  return (
    <article id={entry.id} className="scroll-mt-24 rounded-2xl border border-paper/10 bg-ink-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TAG_STYLE[entry.tag]}`}>{TAG_LABEL[entry.tag][lang] ?? TAG_LABEL[entry.tag].en}</span>
        <time dateTime={new Date(entry.ts).toISOString().slice(0, 10)} className="text-xs text-panda-grey">
          {formatDay(entry.ts, lang)}
        </time>
      </div>
      <h2 className="mt-3 font-display text-lg font-bold leading-snug tracking-tight sm:text-xl">
        {linked ? (
          <Link href={`/updates/${entry.id}`} className="transition-colors hover:text-meme-orange">
            {title}
          </Link>
        ) : (
          title
        )}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-paper/80">{entry.body[lang] ?? entry.body.en}</p>
      {entry.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- an update's own picture, of any size, from the site or an approved address
        <img src={entry.imageUrl} alt={title} loading="lazy" className="mt-4 w-full rounded-xl border border-paper/10" />
      )}
      <div className="mt-4">
        <CopyLink id={entry.id} />
      </div>
    </article>
  );
}

export default function UpdatesClient({ entries, initialOrder = "newest", single = false }: { entries: SiteUpdate[]; initialOrder?: Order; single?: boolean }) {
  const { t } = useLanguage();
  const [order, setOrder] = useState<Order>(initialOrder);
  // `entries` arrive newest first; the other order is the same list, reversed.
  const shown = useMemo(() => (order === "newest" ? entries : [...entries].reverse()), [entries, order]);
  // Opening the list is "seeing" the updates: the newest one is remembered in this browser and the menu's dot goes.
  const { markSeen } = useLatestUpdate();
  const newestId = single ? null : entries[0]?.id ?? null;
  useEffect(() => {
    if (newestId) markSeen(newestId);
  }, [newestId, markSeen]);

  if (single) {
    return (
      <div>
        <Link href="/updates" className="text-sm font-semibold text-panda-grey transition-colors hover:text-paper">
          ← {t("updates.all")}
        </Link>
        <div className="mt-5">{entries[0] && <UpdateCard entry={entries[0]} linked={false} />}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("updates.title")}</h1>
      <p className="mt-2 text-sm text-panda-grey">{t("updates.subtitle")}</p>

      {entries.length > 1 && (
        <div className="mt-6 inline-flex rounded-full border border-paper/10 p-1" role="group" aria-label={t("updates.order")}>
          {(["newest", "oldest"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOrder(o)}
              aria-pressed={order === o}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${order === o ? "bg-paper text-ink" : "text-paper/70 hover:text-paper"}`}
            >
              {t(o === "newest" ? "updates.newest" : "updates.oldest")}
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-paper/10 bg-ink-raised p-6 text-sm text-panda-grey">{t("updates.empty")}</p>
      ) : (
        <div className="mt-6 space-y-4">
          {shown.map((e) => (
            <UpdateCard key={e.id} entry={e} linked />
          ))}
        </div>
      )}
    </div>
  );
}
