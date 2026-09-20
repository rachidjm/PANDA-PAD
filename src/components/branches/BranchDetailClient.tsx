"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { lamportsToSol } from "@/lib/market/format";
import NftGrid from "@/components/themes/NftGrid";
import type { MarketInfo, NftView } from "@/components/themes/types";
import type { PublicBranch } from "@/lib/branches/view";
import { BranchStatusPill } from "./BranchesSection";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; branch: PublicBranch; theme: { slug: string; title: string } | null; nfts: NftView[]; market: MarketInfo };

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const FIELD = "min-w-0 flex-1 rounded-2xl border border-paper/15 bg-ink px-4 py-2.5 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40";

export default function BranchDetailClient({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const { publicKey } = useWallet();
  const { ensureSession } = useWalletSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [contributor, setContributor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/branches?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (r.status === 404) return setState({ kind: "missing" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { branch: PublicBranch; theme: { slug: string; title: string } | null; nfts: NftView[]; market: MarketInfo };
      setState({ kind: "ready", branch: d.branch, theme: d.theme, nfts: d.nfts, market: d.market ?? { enabled: false, secondaryEnabled: false, feeBps: 0 } });
    } catch {
      setState({ kind: "error" });
    }
  }, [slug]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12" aria-hidden>
        <div className="h-56 animate-pulse rounded-[28px] border border-paper/10 bg-ink-raised" />
      </div>
    );
  }
  if (state.kind !== "ready") {
    return (
      <div className="mx-auto max-w-6xl px-5 py-12">
        <Link href="/themes" className="text-sm text-panda-grey transition-colors hover:text-paper">
          ← {t("th.back")}
        </Link>
        <p className="mt-6 text-panda-grey">{state.kind === "missing" ? t("br.notFound") : t("br.loadError")}</p>
      </div>
    );
  }

  const { branch, theme, nfts, market } = state;
  const me = publicKey?.toBase58() ?? null;
  const isCreator = me !== null && me === branch.creator;
  const canAdd = me !== null && (isCreator || branch.contributors.includes(me)) && branch.status === "ACTIVE";

  async function manage(body: Record<string, unknown>) {
    setError("");
    setBusy(true);
    try {
      await ensureSession();
      const r = await fetch("/api/branches/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId: branch.branchId, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t("br.manageError"));
      setContributor("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("br.manageError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      {theme && (
        <Link href={`/themes/${theme.slug}`} className="text-sm text-panda-grey transition-colors hover:text-paper">
          ← {t("br.themeOf")} {theme.title}
        </Link>
      )}

      <section className="mt-5 rounded-[28px] border border-paper/10 bg-ink-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <BranchStatusPill status={branch.status} />
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">{branch.title}</h1>
            <p className="mt-2 text-sm text-panda-grey">
              {t("br.by", { addr: short(branch.creator) })} · {t("br.nftCount", { n: nfts.length })}
            </p>
          </div>
          {canAdd && (
            <Link href={`/branches/${branch.slug}/create`} className="rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90">
              {t("br.add")}
            </Link>
          )}
        </div>

        {branch.description && <p className="mt-4 max-w-3xl text-paper/80">{branch.description}</p>}
        <p className="mt-4 text-xs text-panda-grey">{t("br.openedWith", { buyers: branch.eligibility.uniqueBuyers, sol: lamportsToSol(branch.eligibility.volumeLamports) })}</p>
        {branch.status === "PAUSED" && <p className="mt-4 rounded-xl bg-meme-orange/10 px-4 py-2.5 text-xs text-meme-orange">{t("br.pausedNote")}</p>}
        {canAdd && <p className="mt-3 text-xs text-panda-grey">{t("br.autoName", { title: branch.title })}</p>}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-bold">NFT</h2>
        <p className="mt-1 text-xs text-panda-grey">{t("th.verifiedNote")}</p>
        <div className="mt-5">
          {nfts.length === 0 ? (
            <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-8 text-center text-panda-grey">{t("br.empty")}</div>
          ) : (
            <NftGrid items={nfts} market={market} onChanged={() => void load()} />
          )}
        </div>
      </section>

      {isCreator && branch.status !== "CLOSED" && (
        <section className="mt-10 rounded-[24px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">{t("br.manage")}</h2>

          <p className="mt-4 text-sm font-medium">{t("br.contributors")}</p>
          <p className="mt-0.5 text-xs text-panda-grey">{t("br.contributorsHint")}</p>
          {branch.contributors.length === 0 ? (
            <p className="mt-3 text-sm text-panda-grey">{t("br.contribNone")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-paper/10 rounded-2xl bg-ink">
              {branch.contributors.map((w) => (
                <li key={w} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs">{short(w)}</span>
                  <button onClick={() => manage({ action: "remove_contributor", wallet: w })} disabled={busy} className="text-xs text-panda-grey underline-offset-2 hover:text-clay-red hover:underline disabled:opacity-50">
                    {t("br.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <input value={contributor} onChange={(e) => setContributor(e.target.value.trim())} placeholder={t("br.contribPlaceholder")} className={`${FIELD} font-mono`} aria-label={t("br.contribPlaceholder")} />
            <button onClick={() => manage({ action: "add_contributor", wallet: contributor })} disabled={busy || contributor.length < 32} className="shrink-0 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40">
              {t("br.contribAdd")}
            </button>
          </div>

          <div className="mt-6 border-t border-paper/10 pt-5">
            <button
              onClick={() => {
                if (window.confirm(t("br.closeConfirm"))) void manage({ action: "close" });
              }}
              disabled={busy}
              className="rounded-full border border-clay-red/40 px-5 py-2.5 text-sm font-semibold text-clay-red transition hover:bg-clay-red/10 disabled:opacity-50"
            >
              {t("br.close")}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-clay-red" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
