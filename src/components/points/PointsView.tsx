"use client";

import Panda from "@/components/panda/Panda";
import WalletButton from "@/components/WalletButton";
import Countdown from "@/components/themes/Countdown";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

export type EpochRules = {
  formulaVersion: string;
  trade: { minVolumeLamports: number; lamportsPerUnit: number };
  caps: { perWalletPerEpochTotal: number; maxEventsPerWallet: number };
};
export type PublicEpoch = { id: number; status: string; startTime: number; snapshotTime: number; endTime: number; totalsHash: string | null };
export type MyPoints = {
  current: { epoch: number; total: number; byType: Record<string, number>; events: number; provisional: true } | null;
  finalized: { epoch: number; points: number; verified: boolean }[];
  restriction: { status: "RESTRICTED" | "DISQUALIFIED"; since: number | null; reasonCodes: string[]; appeal: { status: "open" | "accepted" | "rejected" } | null } | null;
};
export type Load = "idle" | "loading" | "ready" | "error";

const REASONS = ["MARKET_CYCLE", "PAIR_CONCENTRATION", "QUICK_FLIP", "CLUSTER_TRADE", "ROUND_TRIPS", "UNIFORM_SIZES", "SHARED_FUNDER", "NEW_WALLET", "SYNCHRONIZED", "EXTREME_FREQUENCY"];
const FIELD = "w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40";

function Card({ children, title, id }: { children: React.ReactNode; title?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-[24px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
      {title && (
        <h2 id={id} className="font-display text-lg font-bold">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export default function PointsView(p: {
  connected: boolean;
  rules: EpochRules | null;
  current: PublicEpoch | null;
  epochsState: Load;
  mine: MyPoints | null;
  mineState: Load;
  onShow: () => void;
  appeal: { text: string; setText: (v: string) => void; send: () => void; busy: boolean; error: string; sent: boolean };
}) {
  const { t, lang } = useLanguage();
  const n = (v: number) => v.toLocaleString(lang);
  const sol = (lamports: number) => (lamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 6 });
  const r = p.rules;
  const restriction = p.mine?.restriction ?? null;
  const appealStatus = restriction?.appeal?.status ?? (p.appeal.sent ? "open" : null);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold">{t("pt.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-panda-grey">{t("pt.subtitle")}</p>
        </div>
        <Panda pose={restriction ? "error" : p.mine?.current && p.mine.current.total > 0 ? "success" : "idle"} size={72} />
      </div>

      <div className="mt-6 space-y-4">
        {/* ---- the epoch that is running ---- */}
        <Card title={p.current ? t("pt.epoch", { n: p.current.id }) : undefined} id="pt-epoch">
          {p.epochsState === "loading" ? (
            <div className="h-10 animate-pulse rounded-xl bg-paper/5" aria-hidden />
          ) : p.current ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="rounded-full bg-bamboo/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-bamboo">{t(`pt.status.${p.current.status}` as DictKey)}</span>
              <span className="flex items-center gap-1.5 text-panda-grey">
                {t("pt.countsUntil")} <Countdown target={p.current.snapshotTime} className="font-semibold text-paper" />
              </span>
            </div>
          ) : (
            <p className="text-sm text-panda-grey">{t("pt.epochNone")}</p>
          )}
        </Card>

        {/* ---- restriction (only ever shown to a restricted wallet) ---- */}
        {restriction && (
          <section aria-labelledby="pt-restricted" className="rounded-[24px] border border-clay-red/40 bg-clay-red/10 p-5 sm:p-6">
            <h2 id="pt-restricted" className="font-display text-lg font-bold text-clay-red">
              {t(`pt.restricted.${restriction.status}` as DictKey)}
            </h2>
            <p className="mt-2 text-sm text-paper/80">{t("pt.restrictedBody")}</p>
            {restriction.reasonCodes.length > 0 && (
              <>
                <p className="mt-4 text-xs font-medium uppercase tracking-wider text-panda-grey">{t("pt.reasonsTitle")}</p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-paper/80">
                  {restriction.reasonCodes.map((c) => (
                    <li key={c}>{REASONS.includes(c) ? t(`pt.reason.${c}` as DictKey) : c}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="mt-5 border-t border-paper/10 pt-5">
              <p className="text-sm font-medium">{t("pt.appeal.title")}</p>
              {appealStatus === "open" ? (
                <p className="mt-2 text-sm text-paper/80">{t("pt.appeal.open")}</p>
              ) : appealStatus === "accepted" ? (
                <p className="mt-2 text-sm text-bamboo">{t("pt.appeal.accepted")}</p>
              ) : (
                <>
                  {appealStatus === "rejected" && <p className="mt-2 text-sm text-paper/80">{t("pt.appeal.rejected")}</p>}
                  <label className="mt-3 block">
                    <span className="mb-1.5 block text-xs text-panda-grey">{t("pt.appeal.help")}</span>
                    <textarea value={p.appeal.text} onChange={(e) => p.appeal.setText(e.target.value)} maxLength={1000} rows={4} className={`${FIELD} resize-none`} />
                  </label>
                  {p.appeal.error && <p className="mt-2 text-sm text-clay-red" role="alert">{p.appeal.error}</p>}
                  <button onClick={p.appeal.send} disabled={p.appeal.busy || p.appeal.text.trim().length < 20} className="mt-3 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {p.appeal.busy ? t("pt.appeal.sending") : t("pt.appeal.send")}
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {/* ---- my points ---- */}
        <Card title={t("pt.mine")} id="pt-mine">
          {!p.connected ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-md text-sm text-panda-grey">{t("pt.connect")}</p>
              <WalletButton />
            </div>
          ) : p.mineState === "idle" ? (
            <button onClick={p.onShow} className="mt-3 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90">
              {t("pt.show")}
            </button>
          ) : p.mineState === "loading" ? (
            <p className="mt-3 text-sm text-panda-grey" role="status">{t("pt.loading")}</p>
          ) : p.mineState === "error" || !p.mine ? (
            <p className="mt-3 text-sm text-clay-red" role="alert">{t("pt.loadError")}</p>
          ) : !p.mine.current ? (
            <p className="mt-3 text-sm text-panda-grey">{t("pt.noEpoch")}</p>
          ) : (
            <div className="mt-3">
              <p className="font-display text-4xl font-bold">{n(p.mine.current.total)}</p>
              <p className="mt-1 text-xs text-panda-grey">
                {t("pt.provisional")} · {t("pt.events", { n: p.mine.current.events })}
              </p>
              {Object.keys(p.mine.current.byType).length === 0 ? (
                <p className="mt-4 text-sm text-panda-grey">{t("pt.none")}</p>
              ) : (
                <dl className="mt-4 divide-y divide-paper/10 rounded-2xl bg-ink">
                  {Object.entries(p.mine.current.byType).map(([type, pts]) => (
                    <div key={type} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                      <dt className="text-panda-grey">{t(`pt.type.${type}` as DictKey)}</dt>
                      <dd className="font-medium">{t("pt.pts", { n: n(pts) })}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </Card>

        {/* ---- finalized epochs ---- */}
        {p.connected && p.mineState === "ready" && p.mine && (
          <Card title={t("pt.past")} id="pt-past">
            {p.mine.finalized.length === 0 ? (
              <p className="mt-3 text-sm text-panda-grey">{t("pt.pastNone")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper/10 rounded-2xl bg-ink">
                {[...p.mine.finalized].reverse().map((e) => (
                  <li key={e.epoch} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{t("pt.epoch", { n: e.epoch })}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-medium">{t("pt.pts", { n: n(e.points) })}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${e.verified ? "bg-bamboo/15 text-bamboo" : "bg-clay-red/15 text-clay-red"}`}>
                        {e.verified ? t("pt.verified") : t("pt.unverified")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* ---- the published rules, with the real numbers ---- */}
        {r && (
          <Card title={t("pt.how")} id="pt-how">
            <ul className="mt-3 space-y-2.5 text-sm text-paper/80">
              <li>{t("pt.how.trade", { unit: sol(r.trade.lamportsPerUnit), min: sol(r.trade.minVolumeLamports) })}</li>
              <li>{t("pt.how.caps", { total: n(r.caps.perWalletPerEpochTotal), events: n(r.caps.maxEventsPerWallet) })}</li>
              <li>{t("pt.how.version", { v: r.formulaVersion })}</li>
              <li className="text-panda-grey">{t("pt.how.noPromise")}</li>
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
