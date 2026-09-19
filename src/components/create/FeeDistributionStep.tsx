"use client";

import { useEffect, useState } from "react";
import { PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { MIN_HOLDING_USD_FOR_REWARDS } from "@/lib/rewards";

type Mode = "creator" | "holders";
type Shareholder = { address: string; shareBps: number };

const REWARDS_POOL = PANDA_REWARDS_POOL?.toBase58() || null;

/**
 * Real, optional part of the Create form: decides whether this coin's real
 * Pump.fun creator fees go to the creator (default — no on-chain config
 * needed, nothing to build) or entirely to PANDA's Holders Rewards Pool —
 * set up via `@pump-fun/pump-sdk`'s fee-sharing config, bundled into the
 * same transaction as the coin itself (see `src/lib/pump/create.ts`). Always
 * valid either way, so it never blocks Launch.
 */
export default function FeeDistributionStep({ onChange }: { onChange: (shareholders: Shareholder[] | null) => void }) {
  const [mode, setMode] = useState<Mode>("creator");

  useEffect(() => {
    onChange(mode === "holders" && REWARDS_POOL ? [{ address: REWARDS_POOL, shareBps: 10_000 }] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">Send creator rewards to</span>
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-ink p-1.5">
        <button
          type="button"
          onClick={() => setMode("creator")}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
            mode === "creator" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
          }`}
        >
          <CrownIcon /> Creator
        </button>
        <button
          type="button"
          onClick={() => REWARDS_POOL && setMode("holders")}
          disabled={!REWARDS_POOL}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            mode === "holders" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
          }`}
        >
          <PeopleIcon /> Holders
        </button>
      </div>
      <p className="mt-2 text-xs text-panda-grey">
        {mode === "creator"
          ? "100% of creator rewards go to you."
          : `100% of creator rewards go to holders. Anyone holding more than $${MIN_HOLDING_USD_FOR_REWARDS} of your coin qualifies.`}
        {!REWARDS_POOL && " Holders routing isn't configured on PANDA yet."}
      </p>
    </div>
  );
}

function CrownIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 18h18" />
      <path d="M4 18 3 8l5 4 4-7 4 7 5-4-1 10" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M21 20c0-2.8-1.9-5.1-4.5-5.8" />
    </svg>
  );
}
