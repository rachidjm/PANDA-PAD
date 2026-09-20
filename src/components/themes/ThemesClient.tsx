"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import Countdown from "./Countdown";
import StatusPill from "./StatusPill";
import type { ThemeView } from "./types";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; themes: ThemeView[] };

/** Active first, then upcoming, then the rest (newest end first). */
const ORDER: Record<string, number> = { ACTIVE: 0, CLOSING: 1, SCHEDULED: 2, ENDED: 3, CLOSED: 3, ARCHIVED: 4, CANCELLED: 5 };

export default function ThemesClient() {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/themes")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { themes: ThemeView[] }) => !cancelled && setState({ kind: "ready", themes: d.themes }))
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <h1 className="font-display text-4xl font-bold tracking-tight">{t("th.title")}</h1>
      <p className="mt-3 max-w-2xl text-panda-grey">{t("th.subtitle")}</p>

      <div className="mt-10">
        {state.kind === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-52 animate-pulse rounded-[24px] border border-paper/10 bg-ink-raised" />
            ))}
          </div>
        )}
        {state.kind === "error" && <p className="text-sm text-clay-red">{t("th.loadError")}</p>}
        {state.kind === "ready" && state.themes.length === 0 && (
          <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">{t("th.none")}</div>
        )}
        {state.kind === "ready" && state.themes.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {[...state.themes]
              .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.endTime - a.endTime)
              .map((th) => (
                <li key={th.themeId}>
                  <ThemeCard theme={th} />
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThemeCard({ theme }: { theme: ThemeView }) {
  const { t } = useLanguage();
  const upcoming = theme.status === "SCHEDULED";
  const live = theme.status === "ACTIVE";
  return (
    <Link
      href={`/themes/${theme.slug}`}
      className="sticker-card block h-full rounded-[24px] border border-paper/10 bg-ink-raised p-6 transition-colors hover:border-paper/25"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl font-bold tracking-tight">{theme.title}</h2>
        <StatusPill status={theme.status} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-panda-grey">{theme.description}</p>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-paper/70">
        {(live || upcoming) && (
          <span className="flex items-center gap-1.5">
            <span className="text-panda-grey">{live ? t("th.endsIn") : t("th.startsIn")}</span>
            <Countdown target={live ? theme.endTime : theme.startTime} className="font-semibold text-paper" />
          </span>
        )}
        <span>{t("th.nfts", { n: theme.nfts })}</span>
        <span>
          {t("th.royalty")} {theme.royaltyBps / 100}%
        </span>
        <span>
          {t("th.limit")}: {theme.creationLimit}
        </span>
      </div>
    </Link>
  );
}
