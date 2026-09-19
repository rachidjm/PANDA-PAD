"use client";

import { useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useWallet } from "@solana/wallet-adapter-react";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { PublicKey } from "@solana/web3.js";
import Panda from "@/components/panda/Panda";
import CoinAvatar from "@/components/CoinAvatar";
import { getWalletPortfolio } from "@/lib/solana/portfolio";
import { computeRewardSource, meetsRewardsThreshold, MIN_HOLDING_USD_FOR_REWARDS } from "@/lib/rewards";
import { fetchTokenPools } from "@/lib/gecko/client";
import { Coin, RewardSource } from "@/lib/types";
import { formatUsd } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const REWARDS_POOL = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL || null;
const LAMPORTS_PER_SOL = 1_000_000_000;

type State = "loading" | "ready" | "error";
type ClaimInfo = { entitledLamports: number; claimedLamports: number; unclaimedLamports: number };

function solStr(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}

export default function RewardsDashboard() {
  const connection = useReadConnection();
  const { connected, publicKey } = useWallet();
  const { t } = useLanguage();
  const [state, setState] = useState<State>("loading");
  const [sources, setSources] = useState<RewardSource[]>([]);
  const [claimInfo, setClaimInfo] = useState<Record<string, ClaimInfo>>({});
  const [poolBalance, setPoolBalance] = useState<number | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [lastClaimSignatures, setLastClaimSignatures] = useState<string[]>([]);

  useEffect(() => {
    if (!REWARDS_POOL) return;
    fetch("/api/rewards/pool-balance")
      .then((r) => r.json())
      .then((d: { configured: boolean; solBalance?: number | null }) => setPoolBalance(d.solBalance ?? null))
      .catch(() => setPoolBalance(null));
  }, []);

  useEffect(() => {
    if (!REWARDS_POOL || !connected || !publicKey) return;
    let cancelled = false;

    Promise.resolve()
      .then(async () => {
        if (!cancelled) setState("loading");
        const coinsRes = await fetch("/api/coins").then((r) => r.json() as Promise<{ coins?: Coin[] }>);
        const coins = coinsRes.coins || [];
        const holdings = await getWalletPortfolio(connection, publicKey, coins);
        const coinByMint = new Map(coins.map((c) => [c.mint.toLowerCase(), c]));

        // Only PANDA-tracked coins can be checked for real fee-sharing config —
        // an arbitrary SPL token was never created through PANDA's Create flow.
        const candidates = holdings.filter((h) => coinByMint.has(h.mint.toLowerCase()));

        const found = await Promise.all(
          candidates.map(async (h): Promise<RewardSource | null> => {
            const coin = coinByMint.get(h.mint.toLowerCase())!;
            try {
              const [configRes, supply] = await Promise.all([
                fetch(`/api/pump/fee-shares?mint=${h.mint}`).then((r) => r.json()) as Promise<{
                  shareholders: { address: string; shareBps: number }[] | null;
                }>,
                connection.getTokenSupply(new PublicKey(h.mint)),
              ]);
              const holders = configRes.shareholders?.find((s) => s.address === REWARDS_POOL);
              if (!holders || holders.shareBps <= 0) return null;

              // Real per-coin price (not the portfolio's top-12-by-amount-capped
              // one, since a small pile of a reward coin could otherwise miss
              // that cutoff) — needed to enforce the real $MIN_HOLDING_USD_FOR_REWARDS
              // eligibility bar, the same one Create tells the creator about.
              const { data } = await fetchTokenPools(h.mint);
              const best = [...data].sort(
                (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
              )[0];
              const priceUsd = best?.attributes.base_token_price_usd ? Number(best.attributes.base_token_price_usd) : undefined;
              const holderValueUsd = priceUsd !== undefined ? priceUsd * h.amount : undefined;

              if (!meetsRewardsThreshold(holderValueUsd)) return null;

              return computeRewardSource({
                coinMint: coin.mint,
                coinTicker: coin.ticker,
                coinImage: coin.image,
                coinDoodle: coin.doodle,
                coinBg: coin.bg,
                holderBalance: h.amount,
                circulatingSupply: supply.value.uiAmount || 0,
                holdersFeeBps: holders.shareBps,
                holderValueUsd,
              });
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;
        const realSources = found.filter((s): s is RewardSource => s !== null);
        setSources(realSources);

        const entries = await Promise.all(
          realSources.map(async (s) => {
            const info = (await fetch(`/api/rewards/claim?mint=${s.coinMint}&holder=${publicKey.toBase58()}`)
              .then((r) => r.json())
              .catch(() => null)) as ClaimInfo | null;
            return [s.coinMint, info || { entitledLamports: 0, claimedLamports: 0, unclaimedLamports: 0 }] as const;
          })
        );
        if (cancelled) return;
        setClaimInfo(Object.fromEntries(entries));
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection]);

  async function claimAll() {
    if (!publicKey || claiming) return;
    setClaiming(true);
    setClaimError("");
    const signatures: string[] = [];
    try {
      // Sequential — every claim is signed by the same server-side Rewards
      // Pool key, so running them one at a time avoids blockhash/nonce races.
      for (const s of sources) {
        const unclaimed = claimInfo[s.coinMint]?.unclaimedLamports || 0;
        if (unclaimed <= 0) continue;
        const res = await fetch("/api/rewards/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mint: s.coinMint, holder: publicKey.toBase58() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t("rd.claimFailedFor", { ticker: s.coinTicker }));
        signatures.push(data.signature);
      }
      setLastClaimSignatures(signatures);

      // Refresh real claim state from the ledger rather than assuming success locally.
      const entries = await Promise.all(
        sources.map(async (s) => {
          const info = (await fetch(`/api/rewards/claim?mint=${s.coinMint}&holder=${publicKey.toBase58()}`)
            .then((r) => r.json())
            .catch(() => null)) as ClaimInfo | null;
          return [s.coinMint, info || { entitledLamports: 0, claimedLamports: 0, unclaimedLamports: 0 }] as const;
        })
      );
      setClaimInfo(Object.fromEntries(entries));
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : t("rd.claimFailed"));
    } finally {
      setClaiming(false);
    }
  }

  const totalEntitled = Object.values(claimInfo).reduce((sum, c) => sum + c.entitledLamports, 0);
  const totalUnclaimed = Object.values(claimInfo).reduce((sum, c) => sum + c.unclaimedLamports, 0);

  if (!REWARDS_POOL) {
    return (
      <div className="mt-12 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="font-medium">{t("rd.poolMissingTitle")}</p>
            <p className="mt-1 text-sm text-panda-grey">
              {t("rd.poolMissingBody")}
            </p>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="mt-12 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="font-medium">{t("rd.connectTitle")}</p>
            <p className="mt-1 text-sm text-panda-grey">{t("rd.connectBody")}</p>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-4">
      {/* YOUR REWARDS — real numbers from the ledger (src/lib/rewards/ledger.ts), credited by the
          daily collect-fees cron from real on-chain distributions. "Pending" stays honest as
          "not tracked" — it would mean fees accrued in Pump's vault but not yet distributed,
          which isn't cheaply checkable per-coin from here yet. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">{t("rd.yourRewards")}</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <p className="text-[11px] text-panda-grey">{t("rd.totalEarned")}</p>
            <p className="mt-1 font-display text-lg font-bold">{solStr(totalEntitled)}</p>
          </div>
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <p className="text-[11px] text-panda-grey">{t("rd.available")}</p>
            <p className="mt-1 font-display text-lg font-bold">{solStr(totalUnclaimed)}</p>
          </div>
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-panda-grey">
              <span>{t("rd.pending")}</span>
              <Tooltip label={t("rd.pendingHint")}>
                <span className="cursor-help text-panda-grey/60">ⓘ</span>
              </Tooltip>
            </div>
            <p className="mt-1 font-display text-lg font-bold text-paper/40">{t("rd.notTracked")}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-paper/10 pt-4">
          <div className="text-xs text-panda-grey">
            {claimError && <p className="text-clay-red">{claimError}</p>}
            {!claimError && lastClaimSignatures.length > 0 && (
              <p className="text-bamboo">
                {t("rd.claimed")}{" "}
                {lastClaimSignatures.map((sig, i) => (
                  <span key={sig}>
                    {i > 0 && ", "}
                    <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noreferrer" className="underline hover:text-paper">
                      {t("rd.viewTx")}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {!claimError && lastClaimSignatures.length === 0 && <p>{t("rd.onChainNote")}</p>}
          </div>
          <button
            onClick={claimAll}
            disabled={claiming || totalUnclaimed <= 0}
            className="shrink-0 rounded-full bg-bamboo px-5 py-2.5 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-paper/10 disabled:text-paper/40"
          >
            {claiming ? t("rd.claiming") : t("rd.claimAll")}
          </button>
        </div>
      </div>

      {poolBalance !== null && (
        <div className="rounded-2xl border border-paper/10 bg-ink-raised p-5">
          <p className="text-xs text-panda-grey">{t("rd.poolTotal")}</p>
          <p className="mt-1 font-display text-xl font-bold">{poolBalance.toFixed(4)} SOL</p>
        </div>
      )}

      {/* YOUR COINS — ticker, real holdings, real share of supply, and real unclaimed amount
          from the ledger (src/lib/rewards/ledger.ts). */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">{t("rd.yourCoins")}</p>
        <p className="mt-1 text-xs text-panda-grey">
          {t("rd.yourCoinsDesc", { min: formatUsd(MIN_HOLDING_USD_FOR_REWARDS) })}
        </p>
        {state === "loading" && (
          <div className="mt-3 space-y-1.5">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-paper/5" />
            ))}
          </div>
        )}
        {state === "error" && <p className="mt-3 text-sm text-clay-red">{t("rd.loadError")}</p>}
        {state === "ready" && sources.length === 0 && (
          <p className="mt-3 text-sm text-panda-grey">
            {t("rd.noneHeld", { min: formatUsd(MIN_HOLDING_USD_FOR_REWARDS) })}
          </p>
        )}
        {state === "ready" && sources.length > 0 && (
          <div className="mt-3 divide-y divide-paper/10">
            {sources.map((s) => (
              <div key={s.coinMint} className="flex items-center gap-3 py-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  <CoinAvatar image={s.coinImage} ticker={s.coinTicker} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">${s.coinTicker}</p>
                  <p className="text-xs text-panda-grey">
                    {t("rd.heldOfSupply", { value: s.holderValueUsd !== undefined ? formatUsd(s.holderValueUsd) : "—", pct: s.holderSharePct.toFixed(3) })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-panda-grey">{t("rd.unclaimed")}</p>
                  <p className="text-sm font-medium">{solStr(claimInfo[s.coinMint]?.unclaimedLamports || 0)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EARNINGS — no historical time-series exists yet (no snapshots/epochs), so this is an
          honest empty state rather than a chart drawn from invented numbers. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">{t("rd.earnings")}</p>
          <div className="flex gap-1">
            {["7D", "30D", "ALL"].map((range) => (
              <span key={range} className="rounded-full bg-paper/5 px-2.5 py-1 text-xs font-semibold text-panda-grey/60">
                {range}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-4 flex h-28 items-center justify-center rounded-2xl bg-ink text-center">
          <p className="max-w-xs text-xs text-panda-grey">
            {t("rd.earningsEmpty")}
          </p>
        </div>
      </div>

      {/* REWARD HISTORY — same reasoning: epochs don't exist yet. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">{t("rd.history")}</p>
        <p className="mt-3 text-sm text-panda-grey">{t("rd.historyEmpty")}</p>
      </div>
    </div>
  );
}
