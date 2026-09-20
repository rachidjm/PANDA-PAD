"use client";

import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import { formatTokenUnits } from "@/lib/economy/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

export type EpochInfo = {
  epoch: number;
  status: string;
  verified: boolean;
  pool?: string;
  distributed?: string;
  dust?: string;
  dustPolicy?: string;
  recipients?: number;
  decimals?: number | null;
  formulaVersion?: string;
  totalsHash?: string;
  allocationHash?: string;
  merkleRoot?: string;
};
export type MyAirdrop = {
  epoch: number;
  status: string;
  verified: boolean;
  eligible?: boolean;
  amount?: string;
  merkleRoot?: string;
  leafCount?: number;
  leafIndex?: number;
  proof?: unknown[];
  claim?: { status: "ELIGIBLE" | "REQUESTED" | "SENT" | "CLAIMED" | "FAILED"; signature: string | null; attempts: number };
};
export type Load = "idle" | "loading" | "ready" | "error";

const hash = (h: string) => (h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h);

function Card({ children, title, id }: { children: React.ReactNode; title: string; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-[24px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
      <h2 id={id} className="font-display text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ink px-4 py-3">
      <dt className="text-xs text-panda-grey">{label}</dt>
      <dd className="mt-0.5 font-display text-base font-bold">{value}</dd>
    </div>
  );
}

export default function AirdropsView(p: {
  connected: boolean;
  claimsOpen: boolean;
  epochs: EpochInfo[];
  epochsState: Load;
  mine: MyAirdrop[] | null;
  mineState: Load;
  onShow: () => void;
  claiming: number | null;
  claimError: { epoch: number; message: string } | null;
  onClaim: (epoch: number) => void;
}) {
  const { t, lang } = useLanguage();
  const decimals = p.epochs.find((e) => e.decimals !== undefined)?.decimals ?? null;
  // Airdrop amounts are shown in full: a truncated figure next to a "0" remainder would misstate what was distributed.
  const units = (v: string) => formatTokenUnits(v, decimals, lang, decimals ?? 2) + (decimals === null ? ` ${t("ad.units")}` : "");

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t("ad.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-panda-grey">{t("ad.subtitle")}</p>
        </div>
        <Panda pose={p.mine?.some((a) => a.claim?.status === "CLAIMED") ? "success" : "idle"} size={72} />
      </div>

      <div className="mt-6 space-y-4">
        {/* ---- mine ---- */}
        <Card title={t("ad.mine")} id="ad-mine">
          {!p.connected ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-md text-sm text-panda-grey">{t("ad.connect")}</p>
              <WalletButton />
            </div>
          ) : p.mineState === "idle" ? (
            <button onClick={p.onShow} className="mt-3 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90">
              {t("ad.show")}
            </button>
          ) : p.mineState === "loading" ? (
            <p className="mt-3 text-sm text-panda-grey" role="status">{t("pt.loading")}</p>
          ) : p.mineState === "error" || !p.mine ? (
            <p className="mt-3 text-sm text-clay-red" role="alert">{t("ad.loadError")}</p>
          ) : p.mine.length === 0 ? (
            <p className="mt-3 text-sm text-panda-grey">{t("ad.none")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...p.mine].reverse().map((a) => {
                const state = a.claim?.status ?? "ELIGIBLE";
                const canClaim = a.eligible && a.verified && (state === "ELIGIBLE" || state === "FAILED") && a.status === "DISTRIBUTING";
                return (
                  <li key={a.epoch} className="rounded-2xl bg-ink p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{t("ad.epoch", { n: a.epoch })}</p>
                      <span className="text-xs text-panda-grey">{t(`ad.status.${a.status}` as DictKey)}</span>
                    </div>

                    {!a.verified ? (
                      <p className="mt-2 text-sm text-clay-red" role="alert">{t("ad.integrity")}</p>
                    ) : !a.eligible ? (
                      <p className="mt-2 text-sm text-panda-grey">{t("ad.notEligible")}</p>
                    ) : (
                      <>
                        <p className="mt-2 text-xs text-panda-grey">{t("ad.amount")}</p>
                        <p className="font-display text-2xl font-bold">{units(a.amount ?? "0")}</p>
                        <p className={`mt-1 text-sm ${state === "CLAIMED" ? "text-bamboo" : state === "FAILED" ? "text-clay-red" : "text-paper/80"}`}>{t(`ad.claimState.${state}` as DictKey)}</p>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {canClaim && (
                            <button
                              onClick={() => p.onClaim(a.epoch)}
                              disabled={!p.claimsOpen || p.claiming !== null}
                              className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {p.claiming === a.epoch ? t("ad.claiming") : t("ad.claim")}
                            </button>
                          )}
                          {canClaim && !p.claimsOpen && <span className="text-xs text-panda-grey">{t("ad.claimsOff")}</span>}
                          {a.claim?.signature && (
                            <a href={`https://solscan.io/tx/${a.claim.signature}`} target="_blank" rel="noopener noreferrer" className="text-sm text-meme-orange hover:underline">
                              {t("ad.viewTx")} ↗
                            </a>
                          )}
                        </div>
                        {p.claimError?.epoch === a.epoch && <p className="mt-2 text-sm text-clay-red" role="alert">{p.claimError.message}</p>}

                        <details className="mt-3 text-xs text-panda-grey">
                          <summary className="cursor-pointer text-paper/70 hover:text-paper">{t("ad.proof")}</summary>
                          <p className="mt-2">{t("ad.proofText", { i: (a.leafIndex ?? 0) + 1, n: a.leafCount ?? 0, k: a.proof?.length ?? 0 })}</p>
                          {a.merkleRoot && <p className="mt-1 break-all font-mono">{a.merkleRoot}</p>}
                        </details>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ---- public transparency ---- */}
        <Card title={t("ad.public")} id="ad-public">
          {p.epochsState === "loading" ? (
            <div className="mt-3 h-24 animate-pulse rounded-xl bg-paper/5" aria-hidden />
          ) : p.epochs.length === 0 ? (
            <p className="mt-3 text-sm text-panda-grey">{t("ad.none")}</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {[...p.epochs].reverse().map((e) => (
                <li key={e.epoch} className="rounded-2xl bg-ink p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{t("ad.epoch", { n: e.epoch })}</p>
                    <span className="text-xs text-panda-grey">{t(`ad.status.${e.status}` as DictKey)}</span>
                  </div>
                  {!e.verified ? (
                    <p className="mt-2 text-sm text-clay-red" role="alert">{t("ad.integrity")}</p>
                  ) : (
                    <>
                      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label={t("ad.pool")} value={units(e.pool ?? "0")} />
                        <Stat label={t("ad.distributed")} value={units(e.distributed ?? "0")} />
                        <Stat label={t("ad.recipients")} value={(e.recipients ?? 0).toLocaleString(lang)} />
                        <Stat label={t("ad.dust")} value={units(e.dust ?? "0")} />
                      </dl>
                      {e.dustPolicy && Number(e.dust ?? 0) > 0 && <p className="mt-2 text-xs text-panda-grey">{t(`ad.dust.${e.dustPolicy}` as DictKey)}</p>}
                      <p className="mt-3 text-xs text-panda-grey">{t("ad.formula")}</p>
                      <details className="mt-2 text-xs text-panda-grey">
                        <summary className="cursor-pointer text-paper/70 hover:text-paper">{t("ad.verifyData")}</summary>
                        <dl className="mt-2 space-y-1.5">
                          {([["ad.totalsHash", e.totalsHash], ["ad.allocationHash", e.allocationHash], ["ad.merkleRoot", e.merkleRoot]] as [DictKey, string | undefined][]).map(([k, v]) =>
                            v ? (
                              <div key={k}>
                                <dt>{t(k)}</dt>
                                <dd className="font-mono text-paper/80" title={v}>
                                  {hash(v)}
                                </dd>
                              </div>
                            ) : null
                          )}
                        </dl>
                      </details>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
