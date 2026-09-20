"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { formatSolAmount, formatTokenUnits } from "@/lib/economy/format";
import { truncateAddress } from "@/lib/format";
import type { EconomySnapshot } from "@/lib/economy/snapshot";

export type EconomyState = "loading" | "ready" | "error";
export type PublicAddresses = { treasury: string; rewardsPool: string | null; tokenMint: string | null };

function Card({ title, unit, children, source }: { title: string; unit: string; children: React.ReactNode; source?: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-paper/10 bg-ink-raised p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-paper/80">{title}</p>
        <span className="rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-panda-grey">{unit}</span>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {source && <p className="mt-4 text-[11px] leading-relaxed text-panda-grey/80">{source}</p>}
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-2xl font-bold">{children}</p>;
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-panda-grey">{label}</span>
      <span className="shrink-0 whitespace-nowrap font-medium">{value}</span>
    </div>
  );
}

function Notes({ items }: { items: (string | false | null | undefined)[] }) {
  const list = items.filter(Boolean) as string[];
  return list.length ? (
    <div className="mt-2 space-y-1">
      {list.map((n) => (
        <p key={n} className="text-xs text-meme-orange">
          {n}
        </p>
      ))}
    </div>
  ) : null;
}

function Unavailable() {
  const { t } = useLanguage();
  return <p className="text-sm text-panda-grey">{t("eco.unavailable")}</p>;
}

function DayBars({ days }: { days: { day: string; lamports: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.lamports));
  return (
    <div className="mt-3 flex h-12 items-end gap-1" role="img" aria-label={days.map((d) => `${d.day}: ${(d.lamports / 1e9).toFixed(2)} SOL`).join(", ")}>
      {days.map((d) => (
        <div key={d.day} className="flex-1 rounded-sm bg-bamboo/80" style={{ height: `${Math.max(d.lamports > 0 ? 8 : 2, (d.lamports / max) * 100)}%`, opacity: d.lamports > 0 ? 1 : 0.25 }} title={`${d.day}`} />
      ))}
    </div>
  );
}

export default function EconomyView({ data, state, addresses }: { data: EconomySnapshot | null; state: EconomyState; addresses: PublicAddresses }) {
  const { t, lang } = useLanguage();
  const sol = (n: number) => `${formatSolAmount(n, lang)} SOL`;
  const since = (ts: number | null) => (ts ? t("eco.since", { date: new Date(ts).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }) }) : null);
  const d = data;
  const sales = (n: number) => t(n === 1 ? "eco.nftSale" : "eco.nftSales", { n });

  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-bold">{t("eco.title")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-panda-grey">{t("eco.intro")}</p>

      {state === "error" && <p className="mt-4 text-sm text-clay-red">{t("eco.unavailable")}</p>}

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {state === "loading" && [0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-paper/5" />)}

        {state === "ready" && d && (
          <>
            <Card title={t("eco.volume")} unit="SOL" source={t("eco.volumeSource")}>
              {d.volume ? (
                d.volume.trades === 0 ? (
                  <p className="text-sm text-panda-grey">{t("eco.nothingYet")}</p>
                ) : (
                  <>
                    <Big>{sol(d.volume.totalLamports)}</Big>
                    <p className="mt-1 text-xs text-panda-grey">{t("eco.volumeSub", { trades: d.volume.trades.toLocaleString(lang), week: formatSolAmount(d.volume.last7dLamports, lang) })}</p>
                    <DayBars days={d.volume.days} />
                    <Notes items={[since(d.volume.since), d.volume.incomplete && t("eco.incomplete")]} />
                  </>
                )
              ) : (
                <Unavailable />
              )}
            </Card>

            <Card title={t("eco.fees")} unit="SOL" source={t("eco.feesSource")}>
              {d.fees && d.fees.since === null ? (
                <p className="text-sm text-panda-grey">{t("eco.nothingYet")}</p>
              ) : d.fees ? (
                <>
                  <Line label={t("eco.feeTrade")} value={sol(d.fees.tradeFeeLamports)} />
                  <Line label={t("eco.feeCreator")} value={sol(d.fees.creatorFeeShareLamports)} />
                  <Notes items={[since(d.fees.since), d.fees.incomplete && t("eco.incomplete")]} />
                </>
              ) : (
                <Unavailable />
              )}
            </Card>

            <Card title={t("eco.creator")} unit="SOL" source={t("eco.creatorSource")}>
              {d.creatorFees ? (
                d.creatorFees.distributions === 0 ? (
                  <p className="text-sm text-panda-grey">{t("eco.nothingYet")}</p>
                ) : (
                  <>
                    <Big>{sol(d.creatorFees.totalLamports)}</Big>
                    <p className="mb-2 mt-1 text-xs text-panda-grey">{t("eco.creatorSub", { n: d.creatorFees.distributions.toLocaleString(lang) })}</p>
                    <Line label={t("eco.creatorHolders")} value={sol(d.creatorFees.toRewardsPoolLamports)} />
                    <Line label={t("eco.creatorPanda")} value={sol(d.creatorFees.toTreasuryLamports)} />
                    <Line label={t("eco.creatorOthers")} value={sol(d.creatorFees.toOthersLamports)} />
                    <Notes items={[since(d.creatorFees.since), d.creatorFees.incomplete && t("eco.incomplete")]} />
                  </>
                )
              ) : (
                <Unavailable />
              )}
            </Card>

            <Card title={t("eco.rewards")} unit="SOL" source={d.rewards ? t("eco.rewardsSource", { n: d.rewards.coins }) : undefined}>
              {d.rewards ? (
                d.rewards.coins === 0 || d.rewards.creditedLamports === 0 ? (
                  <p className="text-sm text-panda-grey">{t("eco.nothingYet")}</p>
                ) : (
                  <>
                    <Big>{sol(d.rewards.creditedLamports)}</Big>
                    <p className="mb-2 mt-1 text-xs text-panda-grey">{t("eco.rewardsCredited")}</p>
                    <Line label={t("eco.rewardsClaimed")} value={sol(d.rewards.claimedLamports)} />
                    <Line label={t("eco.rewardsClaimable")} value={sol(d.rewards.claimableLamports)} />
                    <Notes items={[d.rewards.dustLamports > 0 && t("eco.rewardsDust", { sol: formatSolAmount(d.rewards.dustLamports, lang) }), d.rewards.partial && t("eco.partial")]} />
                  </>
                )
              ) : (
                <Unavailable />
              )}
            </Card>

            <Card title={t("eco.airdrops")} unit="PANDA" source={t("eco.airdropSource")}>
              {d.airdrops ? (
                d.airdrops.epochs.length === 0 && d.airdrops.unverifiedEpochs.length === 0 ? (
                  <p className="text-sm text-panda-grey">{t("eco.airdropNone")}</p>
                ) : (
                  <>
                    <Big>{formatTokenUnits(d.airdrops.totalDistributed, d.airdrops.decimals, lang)}</Big>
                    <p className="mb-2 mt-1 text-xs text-panda-grey">
                      {t("eco.airdropDistributed")}
                      {d.airdrops.decimals === null && ` · ${t("eco.airdropUnits")}`}
                    </p>
                    <Line label={t("eco.airdropClaimed")} value={formatTokenUnits(d.airdrops.totalClaimed, d.airdrops.decimals, lang)} />
                    <ul className="mt-2 space-y-0.5 text-xs text-panda-grey">
                      {d.airdrops.epochs.slice(-4).map((e) => (
                        <li key={e.epoch}>
                          {t("eco.airdropEpoch", {
                            n: e.epoch,
                            claimed: formatTokenUnits(e.claimed, d.airdrops!.decimals, lang),
                            total: formatTokenUnits(e.distributed, d.airdrops!.decimals, lang),
                            count: e.claimedCount,
                          })}
                        </li>
                      ))}
                    </ul>
                    <Notes items={[d.airdrops.unverifiedEpochs.length > 0 && t("eco.airdropUnverified", { list: d.airdrops.unverifiedEpochs.join(", ") }), d.airdrops.partial && t("eco.partial")]} />
                  </>
                )
              ) : (
                <Unavailable />
              )}
            </Card>

            <Card title={t("eco.nft")} unit="SOL" source={t("eco.nftSource")}>
              {d.nft ? (
                d.nft.primary.sales + d.nft.secondary.sales === 0 ? (
                  <p className="text-sm text-panda-grey">{t("eco.nothingYet")}</p>
                ) : (
                  <>
                    <Line label={`${t("eco.nftPrimary")} · ${sales(d.nft.primary.sales)}`} value={sol(d.nft.primary.volumeLamports)} />
                    <Line label={`${t("eco.nftSecondary")} · ${sales(d.nft.secondary.sales)}`} value={sol(d.nft.secondary.volumeLamports)} />
                    <Line label={t("eco.nftFees")} value={sol(d.nft.marketFeesLamports)} />
                    <Line label={t("eco.nftRoyalties")} value={sol(d.nft.royaltiesLamports)} />
                  </>
                )
              ) : (
                <Unavailable />
              )}
            </Card>
          </>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-paper/10 bg-ink-raised p-5">
        <p className="text-sm font-medium text-paper/80">{t("eco.verify")}</p>
        <p className="mt-1 text-xs text-panda-grey">{t("eco.verifyText")}</p>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          {[
            [t("eco.treasury"), addresses.treasury, "account"],
            [t("eco.rewardsPool"), addresses.rewardsPool, "account"],
            [t("eco.tokenMint"), addresses.tokenMint, "token"],
          ].map(([label, address, kind]) =>
            address ? (
              <li key={label}>
                <a href={`https://solscan.io/${kind}/${address}`} target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-paper/[0.04] px-3 py-2 transition-colors hover:bg-paper/10">
                  <span className="block text-xs text-panda-grey">{label}</span>
                  <span className="font-mono text-xs text-meme-orange">{truncateAddress(address)} ↗</span>
                </a>
              </li>
            ) : null
          )}
        </ul>
      </div>
    </section>
  );
}
