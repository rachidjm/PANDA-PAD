"use client";

import { useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Panda from "@/components/panda/Panda";
import Doodle from "@/components/doodles/Doodle";
import { getWalletPortfolio } from "@/lib/solana/portfolio";
import { computeRewardSource } from "@/lib/rewards";
import { Coin, RewardSource } from "@/lib/types";

const REWARDS_POOL = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL || null;

type State = "loading" | "ready" | "error";

export default function RewardsDashboard() {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const [state, setState] = useState<State>("loading");
  const [sources, setSources] = useState<RewardSource[]>([]);
  const [poolBalance, setPoolBalance] = useState<number | null>(null);

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
              return computeRewardSource({
                coinMint: coin.mint,
                coinTicker: coin.ticker,
                coinImage: coin.image,
                coinDoodle: coin.doodle,
                coinBg: coin.bg,
                holderBalance: h.amount,
                circulatingSupply: supply.value.uiAmount || 0,
                holdersFeeBps: holders.shareBps,
              });
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;
        setSources(found.filter((s): s is RewardSource => s !== null));
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, connection]);

  if (!REWARDS_POOL) {
    return (
      <div className="mt-12 rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <div className="flex items-center justify-between gap-6">
          <div>
            <p className="font-medium">Rewards Pool isn&apos;t set up yet</p>
            <p className="mt-1 text-sm text-panda-grey">
              Once PANDA&apos;s Holder Rewards pool is configured, coins with fee distribution enabled will show up
              here — not before.
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
            <p className="font-medium">Connect your wallet to see your rewards</p>
            <p className="mt-1 text-sm text-panda-grey">Hold a coin with fee distribution enabled to start earning.</p>
          </div>
          <Panda pose="empty" size={80} />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 space-y-4">
      {/* YOUR REWARDS — totals stay honest "not tracked yet" instead of a fabricated 0 or amount:
          see RewardSource's comment in types.ts for why a per-coin amount can't be derived yet. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">Your rewards</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: "Total earned", tooltip: "Needs per-coin distribution history, which PANDA doesn't track on-chain yet." },
            { label: "Available to claim", tooltip: "Nothing is claimable yet — the payout distributor isn't live." },
            { label: "Pending", tooltip: "Same limitation as Total earned." },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl bg-ink px-3 py-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-panda-grey">
                <span>{stat.label}</span>
                <Tooltip label={stat.tooltip}>
                  <span className="cursor-help text-panda-grey/60">ⓘ</span>
                </Tooltip>
              </div>
              <p className="mt-1 font-display text-lg font-bold text-paper/40">Not tracked yet</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-paper/10 pt-4">
          <p className="text-xs text-panda-grey">
            Claim payouts require a funded, PANDA-operated distributor that hasn&apos;t been set up yet — coming soon.
            Your real eligibility is shown below in the meantime.
          </p>
          <button disabled className="shrink-0 cursor-not-allowed rounded-full bg-paper/10 px-5 py-2.5 text-sm font-semibold text-paper/40">
            Claim all
          </button>
        </div>
      </div>

      {poolBalance !== null && (
        <div className="rounded-2xl border border-paper/10 bg-ink-raised p-5">
          <p className="text-xs text-panda-grey">PANDA Rewards Pool — total balance (all coins combined)</p>
          <p className="mt-1 font-display text-xl font-bold">{poolBalance.toFixed(4)} SOL</p>
        </div>
      )}

      {/* YOUR COINS — ticker, real holdings, real share of supply. No "rewards generated"
          amount column: same shared-pool limitation as the stats above. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">Your coins</p>
        {state === "loading" && (
          <div className="mt-3 space-y-1.5">
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-paper/5" />
            ))}
          </div>
        )}
        {state === "error" && <p className="mt-3 text-sm text-clay-red">Couldn&apos;t load your rewards — try again in a moment.</p>}
        {state === "ready" && sources.length === 0 && (
          <p className="mt-3 text-sm text-panda-grey">
            You don&apos;t currently hold any coin with fee distribution turned on. Coins that route creator fees to
            holders will show up here.
          </p>
        )}
        {state === "ready" && sources.length > 0 && (
          <div className="mt-3 divide-y divide-paper/10">
            {sources.map((s) => (
              <div key={s.coinMint} className="flex items-center gap-3 py-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-paper/10">
                  {s.coinImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.coinImage} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Doodle kind={s.coinDoodle} className="h-full w-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">${s.coinTicker}</p>
                  <p className="text-xs text-panda-grey">
                    {s.holderBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} held — {s.holderSharePct.toFixed(3)}%
                    of supply
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-panda-grey">Holders get</p>
                  <p className="text-sm font-medium">{(s.holdersFeeBps / 100).toFixed(1)}%</p>
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
          <p className="text-sm font-medium">Earnings</p>
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
            Not enough reward history to chart yet — this fills in once the payout distributor is live.
          </p>
        </div>
      </div>

      {/* REWARD HISTORY — same reasoning: epochs don't exist yet. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">Reward history</p>
        <p className="mt-3 text-sm text-panda-grey">No epochs yet — this fills in once PANDA starts running reward epochs.</p>
      </div>
    </div>
  );
}
