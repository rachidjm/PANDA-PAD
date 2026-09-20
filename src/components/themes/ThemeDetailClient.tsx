"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import Countdown from "./Countdown";
import NftGrid from "./NftGrid";
import StatusPill from "./StatusPill";
import { isOpen, NftView, ThemeView } from "./types";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; theme: ThemeView; nfts: NftView[] };

const solStr = (lamports: string) => {
  const n = Number(lamports) / 1e9;
  return `${n >= 1 ? n.toFixed(2) : n.toPrecision(2)} SOL`;
};

export default function ThemeDetailClient({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/themes?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (r.status === 404) return !cancelled && setState({ kind: "missing" });
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { theme: ThemeView; nfts: NftView[] };
        if (!cancelled) setState({ kind: "ready", theme: d.theme, nfts: d.nfts });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12" aria-hidden>
        <div className="h-64 animate-pulse rounded-[28px] border border-paper/10 bg-ink-raised" />
      </div>
    );
  }
  if (state.kind !== "ready") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <BackLink />
        <p className="mt-6 text-panda-grey">{state.kind === "missing" ? t("th.notFound") : t("th.loadError")}</p>
      </div>
    );
  }

  const { theme, nfts } = state;
  const open = isOpen(theme, now) && theme.status === "ACTIVE";
  const live = theme.status === "ACTIVE";
  const upcoming = theme.status === "SCHEDULED";
  const hasPool = Number(theme.rewardPool.lamports) > 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <BackLink />

      <section className="mt-5 rounded-[28px] border border-paper/10 bg-ink-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <StatusPill status={theme.status} />
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">{theme.title}</h1>
          </div>
          {(live || upcoming) && (
            <div className="rounded-2xl bg-ink px-5 py-3 text-right">
              <p className="text-xs text-panda-grey">{live ? t("th.endsIn") : t("th.startsIn")}</p>
              <Countdown target={live ? theme.endTime : theme.startTime} className="text-2xl font-bold" />
            </div>
          )}
        </div>

        <p className="mt-4 max-w-3xl text-paper/80">{theme.description}</p>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="NFT" value={String(theme.nfts)} />
          <Stat label={t("th.royalty")} value={`${theme.royaltyBps / 100}%`} />
          <Stat label={t("th.limit")} value={String(theme.creationLimit)} />
          {hasPool && <Stat label={t("th.rewardPool")} value={solStr(theme.rewardPool.lamports)} />}
        </dl>

        <div className="mt-6 rounded-2xl bg-ink px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-panda-grey">{t("th.rules")}</p>
          <p className="mt-2 whitespace-pre-line text-sm text-paper/80">{theme.rules}</p>
        </div>

        <div className="mt-6">
          {open ? (
            <Link
              href={`/themes/${theme.slug}/create`}
              className="inline-block rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90"
            >
              {t("th.create")}
            </Link>
          ) : (
            <p className="text-sm text-panda-grey">{upcoming ? t("th.notStarted") : t("th.closedNote")}</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">NFT</h2>
        <p className="mt-1 text-xs text-panda-grey">{t("th.verifiedNote")}</p>
        <div className="mt-5">
          {nfts.length === 0 ? (
            <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">
              {open ? t("th.empty") : t("th.emptyClosed")}
            </div>
          ) : (
            <NftGrid items={nfts} />
          )}
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  const { t } = useLanguage();
  return (
    <Link href="/themes" className="text-sm text-panda-grey transition-colors hover:text-paper">
      ← {t("th.back")}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ink px-4 py-3">
      <dt className="text-xs text-panda-grey">{label}</dt>
      <dd className="mt-0.5 font-display text-lg font-bold">{value}</dd>
    </div>
  );
}
