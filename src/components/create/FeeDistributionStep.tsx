"use client";

import { useEffect, useState } from "react";
import { PANDA_REWARDS_POOL, PANDA_TREASURY, PANDA_PROTOCOL_FEE_BPS } from "@/lib/pump/constants";
import { MIN_HOLDING_USD_FOR_REWARDS } from "@/lib/rewards";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Mode = "creator" | "holders";
type Shareholder = { address: string; shareBps: number };

const REWARDS_POOL = PANDA_REWARDS_POOL?.toBase58() || null;
const REMAINING_BPS = 10_000 - PANDA_PROTOCOL_FEE_BPS;

/**
 * Real, always-on part of the Create form: PANDA takes a fixed 5% of this
 * coin's Pump.fun creator fees (not configurable, not skippable — see
 * PANDA_PROTOCOL_FEE_BPS in constants.ts); the creator only chooses where
 * the remaining 95% goes — to themselves (default) or to PANDA's Holders
 * Rewards Pool. Set up via `@pump-fun/pump-sdk`'s fee-sharing config,
 * bundled into the same transaction as the coin itself (see
 * `src/lib/pump/create.ts`) — every coin created through PANDA gets a real
 * on-chain `SharingConfig`, since PANDA's cut has to exist on-chain to be
 * real.
 */
export default function FeeDistributionStep({
  creator,
  onChange,
}: {
  creator: string;
  onChange: (shareholders: Shareholder[]) => void;
}) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>("creator");
  const remainingRecipient = mode === "holders" && REWARDS_POOL ? REWARDS_POOL : creator;

  useEffect(() => {
    onChange([
      { address: PANDA_TREASURY.toBase58(), shareBps: PANDA_PROTOCOL_FEE_BPS },
      { address: remainingRecipient, shareBps: REMAINING_BPS },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingRecipient]);

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("fd.title")}</span>

      <div className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
        <span className="text-sm">{t("fd.protocol")}</span>
        <span className="text-xs text-panda-grey">{t("fd.fixed", { pct: PANDA_PROTOCOL_FEE_BPS / 100 })}</span>
      </div>

      <span className="mb-1.5 mt-3 block text-xs text-panda-grey">
        {t("fd.sendRemaining", { pct: REMAINING_BPS / 100 })}
      </span>
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-ink p-1.5">
        <button
          type="button"
          onClick={() => setMode("creator")}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors ${
            mode === "creator" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
          }`}
        >
          <CrownIcon /> {t("fd.creator")}
        </button>
        <button
          type="button"
          onClick={() => REWARDS_POOL && setMode("holders")}
          disabled={!REWARDS_POOL}
          className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            mode === "holders" ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"
          }`}
        >
          <PeopleIcon /> {t("fd.holders")}
        </button>
      </div>
      <p className="mt-2 text-xs text-panda-grey">
        {mode === "creator"
          ? t("fd.creatorNote", { pct: REMAINING_BPS / 100, fee: PANDA_PROTOCOL_FEE_BPS / 100 })
          : t("fd.holdersNote", { pct: REMAINING_BPS / 100, min: MIN_HOLDING_USD_FOR_REWARDS, fee: PANDA_PROTOCOL_FEE_BPS / 100 })}
        {!REWARDS_POOL && ` ${t("fd.notConfigured")}`}
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
