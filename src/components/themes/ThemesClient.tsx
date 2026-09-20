"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { lamportsToSol } from "@/lib/market/format";
import Countdown from "./Countdown";
import StatusPill from "./StatusPill";
import type { ThemeView } from "./types";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; themes: ThemeView[] };

type Section = "active" | "upcoming" | "completed";
/** Where a theme belongs on the page. Cancelled themes are left out: nothing happened there. */
const SECTION_OF: Record<string, Section | null> = { ACTIVE: "active", CLOSING: "active", SCHEDULED: "upcoming", ENDED: "completed", CLOSED: "completed", ARCHIVED: "completed", CANCELLED: null };

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
        {state.kind === "ready" && state.themes.length > 0 && <Sections themes={state.themes} />}
      </div>
    </div>
  );
}

function Sections({ themes }: { themes: ThemeView[] }) {
  const { t } = useLanguage();
  const groups: { id: Section; title: string; list: ThemeView[] }[] = [
    // Active: soonest to end first. Upcoming: soonest to start first. Completed: most recently ended first.
    { id: "active", title: t("th.secActive"), list: themes.filter((x) => SECTION_OF[x.status] === "active").sort((a, b) => a.endTime - b.endTime) },
    { id: "upcoming", title: t("th.secUpcoming"), list: themes.filter((x) => SECTION_OF[x.status] === "upcoming").sort((a, b) => a.startTime - b.startTime) },
    { id: "completed", title: t("th.secCompleted"), list: themes.filter((x) => SECTION_OF[x.status] === "completed").sort((a, b) => b.endTime - a.endTime) },
  ];
  const shown = groups.filter((g) => g.list.length > 0);
  if (shown.length === 0) return <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">{t("th.none")}</div>;
  return (
    <div className="space-y-10">
      {shown.map((g) => (
        <section key={g.id} aria-labelledby={`themes-${g.id}`}>
          <h2 id={`themes-${g.id}`} className="mb-4 flex items-baseline gap-2 font-display text-xl font-bold">
            {g.title}
            <span className="text-sm font-medium text-panda-grey">{g.list.length}</span>
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {g.list.map((th) => (
              <li key={th.themeId}>
                <ThemeCard theme={th} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ThemeCard({ theme }: { theme: ThemeView }) {
  const { t } = useLanguage();
  const upcoming = theme.status === "SCHEDULED";
  const live = theme.status === "ACTIVE";
  const completed = SECTION_OF[theme.status] === "completed";
  const stats = [
    t(theme.nfts === 1 ? "th.nftOne" : "th.nfts", { n: theme.nfts }),
    theme.creators !== undefined ? t(theme.creators === 1 ? "th.creator" : "th.creators", { n: theme.creators }) : null,
    // Volume only exists when the market is on; it is never shown as 0 when it simply isn't tracked.
    // A theme that hasn't started has no volume to speak of.
    theme.volumeLamports != null && !upcoming ? t(completed ? "th.volumeFinal" : "th.volumeLive", { v: lamportsToSol(theme.volumeLamports) }) : null,
    theme.branches ? t(theme.branches === 1 ? "th.branchOne" : "th.branchMany", { n: theme.branches }) : null,
  ].filter(Boolean);
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
        {stats.map((s) => (
          <span key={s as string}>{s}</span>
        ))}
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
