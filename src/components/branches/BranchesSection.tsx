"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import WalletButton from "@/components/WalletButton";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { lamportsToSol } from "@/lib/market/format";
import type { PublicBranch } from "@/lib/branches/view";

export type Rules = { eligibility: { minUniqueBuyers: number; minVolumeLamports: number; minHoldMs: number } };
export type Criterion = { key: "uniqueBuyers" | "volume" | "noFlags"; required: number; actual: number; met: boolean };
export type Eligibility = {
  eligible: boolean;
  criteria: Criterion[];
  excluded: { selfPurchase: number; returnedOwner: number; flagged: number; heldTooShort: number };
  minHoldHours: number;
};

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const FIELD = "w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40";

export function BranchStatusPill({ status }: { status: PublicBranch["status"] }) {
  const { t } = useLanguage();
  const cls = status === "ACTIVE" ? "bg-bamboo/15 text-bamboo" : status === "PAUSED" ? "bg-meme-orange/15 text-meme-orange" : "bg-paper/10 text-panda-grey";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${cls}`}>{t(`br.status.${status}`)}</span>;
}

/** The criteria, what the wallet has, and (when eligible) the form to open the branch. Pure: everything comes in as props. */
export function EligibilityView({
  elig,
  need,
  title,
  setTitle,
  description,
  setDescription,
  busy,
  onOpen,
}: {
  elig: Eligibility;
  need: Rules["eligibility"] | undefined;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  busy: boolean;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const fmt = (c: Criterion) =>
    c.key === "uniqueBuyers" ? `${c.actual} / ${c.required}` : c.key === "volume" ? `◎ ${lamportsToSol(c.actual)} / ${lamportsToSol(c.required)}` : c.met ? t("br.crit.yes") : t("br.crit.no");
  const label = (c: Criterion) => (c.key === "uniqueBuyers" ? t("br.crit.uniqueBuyers", { h: elig.minHoldHours }) : c.key === "volume" ? t("br.crit.volume") : t("br.crit.noFlags"));
  const ex = elig.excluded;

  return (
    <>
      <ul className="mt-4 space-y-3">
        {elig.criteria.map((c) => (
          <li key={c.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={c.met ? "text-paper" : "text-paper/70"}>
                <span className={c.met ? "text-bamboo" : "text-panda-grey"} aria-hidden>
                  {c.met ? "✓" : "○"}{" "}
                </span>
                {label(c)}
              </span>
              <span className="shrink-0 font-medium">{fmt(c)}</span>
            </div>
            {c.key !== "noFlags" && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper/10">
                <div className={`h-full rounded-full ${c.met ? "bg-bamboo" : "bg-meme-orange"}`} style={{ width: `${Math.min(100, (c.actual / c.required) * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {ex && ex.selfPurchase + ex.returnedOwner + ex.flagged + ex.heldTooShort > 0 && (
        <p className="mt-3 text-xs text-panda-grey">{t("br.excluded", { self: ex.selfPurchase, ret: ex.returnedOwner, flag: ex.flagged, hold: ex.heldTooShort })}</p>
      )}

      {elig.eligible ? (
        <div className="mt-5 border-t border-paper/10 pt-5">
          <p className="text-sm font-medium text-bamboo">{t("br.eligible")}</p>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("br.form.title")}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={24} className={FIELD} />
            <span className="mt-1 block text-xs text-panda-grey">{t("br.form.titleHint")}</span>
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("br.form.description")}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} className={`${FIELD} resize-none`} />
          </label>
          <button onClick={onOpen} disabled={busy || title.trim().length < 3} className="mt-5 rounded-full bg-paper px-6 py-3 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? t("br.form.submitting") : t("br.form.submit")}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-panda-grey">{t("br.notEligible")}</p>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-panda-grey/80">
        {need && t("br.method", { h: elig.minHoldHours, buyers: need.minUniqueBuyers, sol: lamportsToSol(need.minVolumeLamports) })}
      </p>
    </>
  );
}

/** The branches of a theme, and — for a connected wallet — whether it can open one and exactly why or why not. Renders nothing while branches are off. */
export default function BranchesSection({ themeSlug, themeStatus }: { themeSlug: string; themeStatus: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { connected } = useWallet();
  const { ensureSession } = useWalletSession();

  const [branches, setBranches] = useState<PublicBranch[] | null | "off">(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [busy, setBusy] = useState<"check" | "create" | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/branches?theme=${encodeURIComponent(themeSlug)}`, { cache: "no-store" });
    if (r.status === 404) return setBranches("off");
    if (!r.ok) return setBranches([]);
    const d = (await r.json()) as { branches: PublicBranch[]; rules: Rules };
    setBranches(d.branches);
    setRules(d.rules);
  }, [themeSlug]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  if (branches === "off" || branches === null) return null;
  const started = !["DRAFT", "SCHEDULED", "CANCELLED"].includes(themeStatus);

  async function check() {
    setError("");
    setBusy("check");
    try {
      await ensureSession();
      const r = await fetch(`/api/branches/eligibility?theme=${encodeURIComponent(themeSlug)}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t("br.err.generic"));
      setElig(d as Eligibility);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("br.err.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function open() {
    setError("");
    setBusy("create");
    try {
      const r = await fetch("/api/branches/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ themeSlug, title, description }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t("br.err.generic"));
      router.push(`/branches/${(d as { branch: PublicBranch }).branch.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("br.err.generic"));
      setBusy(null);
    }
  }

  const need = rules?.eligibility;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl font-bold">{t("br.title")}</h2>
      <p className="mt-1 max-w-3xl text-xs text-panda-grey">{t("br.intro")}</p>

      <div className="mt-5">
        {branches.length === 0 ? (
          <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6 text-center text-sm text-panda-grey">{t("br.none")}</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => (
              <li key={b.branchId}>
                <Link href={`/branches/${b.slug}`} className="block h-full rounded-[20px] border border-paper/10 bg-ink-raised p-5 transition-colors hover:border-paper/30">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-display text-lg font-bold">{b.title}</p>
                    <BranchStatusPill status={b.status} />
                  </div>
                  {b.description && <p className="mt-1.5 line-clamp-2 text-sm text-paper/70">{b.description}</p>}
                  <p className="mt-3 text-xs text-panda-grey">
                    {t("br.by", { addr: short(b.creator) })} · {t("br.nftCount", { n: b.nfts })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {started && (
        <div className="mt-6 rounded-[24px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
          <p className="font-medium">{t("br.open.title")}</p>

          {!connected ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-md text-sm text-panda-grey">{t("br.open.connect")}</p>
              <WalletButton />
            </div>
          ) : !elig ? (
            <>
              {need && (
                <p className="mt-2 max-w-3xl text-xs text-panda-grey">
                  {t("br.method", { h: Math.round(need.minHoldMs / 3_600_000), buyers: need.minUniqueBuyers, sol: lamportsToSol(need.minVolumeLamports) })}
                </p>
              )}
              <button onClick={check} disabled={busy === "check"} className="mt-4 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:opacity-50">
                {busy === "check" ? t("br.open.checking") : t("br.open.check")}
              </button>
            </>
          ) : (
            <>
              <EligibilityView
                elig={elig}
                need={need}
                title={title}
                setTitle={setTitle}
                description={description}
                setDescription={setDescription}
                busy={busy === "create"}
                onOpen={open}
              />
            </>
          )}
          {error && <p className="mt-3 text-sm text-clay-red" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
