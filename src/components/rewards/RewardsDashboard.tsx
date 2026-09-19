"use client";

import { useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Panda from "@/components/panda/Panda";
import Doodle from "@/components/doodles/Doodle";
import { getWalletPortfolio } from "@/lib/solana/portfolio";
import { computeRewardSource, meetsRewardsThreshold, MIN_HOLDING_USD_FOR_REWARDS } from "@/lib/rewards";
import { fetchTokenPools } from "@/lib/gecko/client";
import { Coin, RewardSource } from "@/lib/types";
import { formatUsd } from "@/lib/format";

const REWARDS_POOL = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL || null;
const LAMPORTS_PER_SOL = 1_000_000_000;

type State = "loading" | "ready" | "error";
type ClaimInfo = { entitledLamports: number; claimedLamports: number; unclaimedLamports: number };

function solStr(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}

export default function RewardsDashboard() {
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
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
        if (!res.ok) throw new Error(data.error || `Claim failed for $${s.coinTicker}.`);
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
      setClaimError(err instanceof Error ? err.message : "Claim failed.");
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
      {/* YOUR REWARDS — real numbers from the ledger (src/lib/rewards/ledger.ts), credited by the
          daily collect-fees cron from real on-chain distributions. "Pending" stays honest as
          "not tracked" — it would mean fees accrued in Pump's vault but not yet distributed,
          which isn't cheaply checkable per-coin from here yet. */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">Your rewards</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <p className="text-[11px] text-panda-grey">Total earned</p>
            <p className="mt-1 font-display text-lg font-bold">{solStr(totalEntitled)}</p>
          </div>
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <p className="text-[11px] text-panda-grey">Available to claim</p>
            <p className="mt-1 font-display text-lg font-bold">{solStr(totalUnclaimed)}</p>
          </div>
          <div className="rounded-2xl bg-ink px-3 py-3.5 text-center">
            <div className="flex items-center justify-center gap-1 text-[11px] text-panda-grey">
              <span>Pending</span>
              <Tooltip label="Fees that may have accrued in Pump.fun's own vault but haven't been distributed by PANDA's daily collector yet — not tracked here.">
                <span className="cursor-help text-panda-grey/60">ⓘ</span>
              </Tooltip>
            </div>
            <p className="mt-1 font-display text-lg font-bold text-paper/40">Not tracked</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-paper/10 pt-4">
          <div className="text-xs text-panda-grey">
            {claimError && <p className="text-clay-red">{claimError}</p>}
            {!claimError && lastClaimSignatures.length > 0 && (
              <p className="text-bamboo">
                Claimed —{" "}
                {lastClaimSignatures.map((sig, i) => (
                  <span key={sig}>
                    {i > 0 && ", "}
                    <a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noreferrer" className="underline hover:text-paper">
                      view tx
                    </a>
                  </span>
                ))}
              </p>
            )}
            {!claimError && lastClaimSignatures.length === 0 && <p>Real, on-chain payouts — signed and sent the moment you claim.</p>}
          </div>
          <button
            onClick={claimAll}
            disabled={claiming || totalUnclaimed <= 0}
            className="shrink-0 rounded-full bg-bamboo px-5 py-2.5 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-paper/10 disabled:text-paper/40"
          >
            {claiming ? "Claiming…" : "Claim all"}
          </button>
        </div>
      </div>

      {poolBalance !== null && (
        <div className="rounded-2xl border border-paper/10 bg-ink-raised p-5">
          <p className="text-xs text-panda-grey">PANDA Rewards Pool — total balance (all coins combined)</p>
          <p className="mt-1 font-display text-xl font-bold">{poolBalance.toFixed(4)} SOL</p>
        </div>
      )}

      {/* YOUR COINS — ticker, real holdings, real share of supply, and real unclaimed amount
          from the ledger (src/lib/rewards/ledger.ts). */}
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <p className="text-sm font-medium">Your coins</p>
        <p className="mt-1 text-xs text-panda-grey">
          Coins with Holders fee distribution turned on, where you hold more than {formatUsd(MIN_HOLDING_USD_FOR_REWARDS)} —
          same real eligibility bar shown at Create.
        </p>
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
            You don&apos;t currently hold more than {formatUsd(MIN_HOLDING_USD_FOR_REWARDS)} of any coin with fee
            distribution turned on. Coins that route creator fees to holders will show up here once you do.
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
                    {s.holderValueUsd !== undefined ? formatUsd(s.holderValueUsd) : "—"} held — {s.holderSharePct.toFixed(3)}%
                    of supply
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-panda-grey">Unclaimed</p>
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
