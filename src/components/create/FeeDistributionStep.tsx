"use client";

import { useEffect, useMemo, useState } from "react";
import { PANDA_REWARDS_POOL, PANDA_TREASURY } from "@/lib/pump/constants";
import { CREATOR_CONFIGURABLE_MAX_BPS, PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { FeeLine, PlanIssue, formatBps, parsePercentToBps, planIssue, planLines } from "@/lib/pump/fee-plan";
import { MIN_HOLDING_USD_FOR_REWARDS } from "@/lib/rewards";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

const REWARDS_POOL = PANDA_REWARDS_POOL?.toBase58() || null;
const TREASURY = PANDA_TREASURY.toBase58();

export type FeeDistributionResult = { lines: FeeLine[]; issue: PlanIssue | null; invalidNumber: boolean };

/**
 * The always-on part of the Create form. PANDA's 5% is locked (see
 * PANDA_SHARE_BPS) and shown as such; the creator splits the other 95%
 * between themselves, PANDA's Holders pool and an optional partner wallet.
 * Everything is integer basis points; the plan is pre-checked here for instant
 * feedback, and the server re-validates the final list on its own — this
 * component is never the thing that enforces PANDA's share.
 */
export default function FeeDistributionStep({
  creator,
  onChange,
}: {
  creator: string;
  onChange: (result: FeeDistributionResult) => void;
}) {
  const { t } = useLanguage();
  // The Holders band exists only while FEATURE_HOLDER_REWARDS is on (and the pool is configured); otherwise the split is PANDA 5% + Creator + optional partner.
  const { holderRewards } = useFeatures();
  const holdersPool = holderRewards ? REWARDS_POOL : null;
  const [creatorPct, setCreatorPct] = useState("95");
  const [holdersPct, setHoldersPct] = useState("0");
  const [partnerPct, setPartnerPct] = useState("0");
  const [partnerOn, setPartnerOn] = useState(false);
  const [partnerAddress, setPartnerAddress] = useState("");

  const parsed = useMemo(() => {
    const c = parsePercentToBps(creatorPct);
    const h = parsePercentToBps(holdersPct);
    const p = partnerOn ? parsePercentToBps(partnerPct) : 0;
    return { c, h, p, invalidNumber: c === null || h === null || p === null };
  }, [creatorPct, holdersPct, partnerPct, partnerOn]);

  const ctx = useMemo(() => ({ creator, treasury: TREASURY, rewardsPool: holdersPool }), [creator, holdersPool]);

  const { lines, issue } = useMemo(() => {
    const plan = {
      creatorBps: parsed.c ?? 0,
      holdersBps: parsed.h ?? 0,
      partnerBps: parsed.p ?? 0,
      partnerAddress,
    };
    return { lines: planLines(plan, ctx), issue: planIssue(plan, ctx) };
  }, [parsed, partnerAddress, ctx]);

  useEffect(() => {
    onChange({ lines, issue, invalidNumber: parsed.invalidNumber });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, issue, parsed.invalidNumber]);

  const assigned = (parsed.c ?? 0) + (parsed.h ?? 0) + (parsed.p ?? 0);

  function preset(creatorBps: number, holdersBps: number) {
    setCreatorPct(formatBps(creatorBps));
    setHoldersPct(formatBps(holdersBps));
    setPartnerPct("0");
    setPartnerOn(false);
  }

  const problem = parsed.invalidNumber ? t("fd.err.number") : issueMessage(issue, t);

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("fd.title")}</span>

      {/* PANDA's share — locked, never an input. */}
      <div className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-sm">
          <LockIcon /> {t("fd.protocol")}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">{PANDA_SHARE_BPS / 100}%</span>
          <span className="rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-paper/70">
            {t("fd.locked")}
          </span>
        </span>
      </div>
      <p className="mt-1.5 text-xs text-panda-grey">{t("fd.protocolNote")}</p>

      {/* Where the whole 100% goes, at a glance. */}
      <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-ink" aria-hidden>
        {lines.map((l) => (
          <div key={l.kind} className={`h-full ${BAR_COLOR[l.kind]} transition-all`} style={{ width: `${l.bps / 100}%` }} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-panda-grey">
          {t("fd.yourAllocation")} · {formatBps(CREATOR_CONFIGURABLE_MAX_BPS)}%
        </span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => preset(CREATOR_CONFIGURABLE_MAX_BPS, 0)} className={CHIP}>
            {t("fd.presetAllMe")}
          </button>
          {holderRewards && (
            <button
              type="button"
              disabled={!REWARDS_POOL}
              onClick={() => preset(5000, 4500)}
              className={`${CHIP} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {t("fd.presetHolders")}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        <Row dot={BAR_COLOR.creator} icon={<CrownIcon />} label={t("fd.creator")} value={creatorPct} onChange={setCreatorPct} />
        {holderRewards && (
          <Row
            dot={BAR_COLOR.holders}
            icon={<PeopleIcon />}
            label={t("fd.holders")}
            value={holdersPct}
            onChange={setHoldersPct}
            disabled={!REWARDS_POOL}
          />
        )}
        {partnerOn ? (
          <div className="rounded-xl bg-ink px-3.5 py-2.5">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAR_COLOR.partner}`} aria-hidden />
              <span className="flex flex-1 items-center gap-2 text-sm">
                <HandshakeIcon /> {t("fd.partner")}
              </span>
              <PercentInput value={partnerPct} onChange={setPartnerPct} label={t("fd.partner")} />
              <button
                type="button"
                onClick={() => {
                  setPartnerOn(false);
                  setPartnerPct("0");
                  setPartnerAddress("");
                }}
                className="text-xs text-panda-grey transition-colors hover:text-paper"
              >
                {t("fd.removePartner")}
              </button>
            </div>
            <input
              value={partnerAddress}
              onChange={(e) => setPartnerAddress(e.target.value)}
              placeholder={t("fd.partnerAddress")}
              spellCheck={false}
              autoComplete="off"
              className="mt-2 w-full rounded-lg bg-ink-raised px-3 py-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPartnerOn(true)}
            className="w-full rounded-xl border border-dashed border-paper/15 py-2.5 text-xs text-panda-grey transition-colors hover:border-paper/30 hover:text-paper"
          >
            {t("fd.addPartner")}
          </button>
        )}
      </div>

      {(parsed.h ?? 0) > 0 && (
        <p className="mt-2 text-xs text-panda-grey">{t("fd.holdersInfo", { min: MIN_HOLDING_USD_FOR_REWARDS })}</p>
      )}
      {holderRewards && !REWARDS_POOL && <p className="mt-2 text-xs text-panda-grey">{t("fd.notConfigured")}</p>}

      <p className={`mt-3 text-xs ${problem ? "text-clay-red" : "text-bamboo"}`} role={problem ? "alert" : undefined}>
        {problem ??
          t("fd.total", { panda: PANDA_SHARE_BPS / 100, rest: formatBps(assigned), total: formatBps(PANDA_SHARE_BPS + assigned) })}
      </p>
    </div>
  );
}

const CHIP = "whitespace-nowrap rounded-full bg-paper/5 px-3 py-1 text-xs font-medium text-paper/70 transition-colors hover:bg-paper/10 hover:text-paper";

export const BAR_COLOR: Record<FeeLine["kind"], string> = {
  panda: "bg-paper/40",
  creator: "bg-bamboo",
  holders: "bg-meme-orange",
  partner: "bg-panda-grey",
};

function issueMessage(issue: PlanIssue | null, t: ReturnType<typeof useLanguage>["t"]): string | null {
  if (!issue) return null;
  switch (issue.code) {
    case "TOTAL_MISMATCH":
      return issue.deltaBps > 0
        ? t("fd.err.under", { pct: formatBps(issue.deltaBps) })
        : t("fd.err.over", { pct: formatBps(-issue.deltaBps) });
    case "HOLDERS_UNAVAILABLE":
      return t("fd.notConfigured");
    case "PARTNER_ADDRESS_INVALID":
      return t("fd.err.partnerInvalid");
    case "PARTNER_ADDRESS_DUPLICATE":
      return t("fd.err.partnerDup");
  }
}

function Row({
  dot,
  icon,
  label,
  value,
  onChange,
  disabled,
}: {
  dot: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl bg-ink px-3.5 py-2.5 ${disabled ? "opacity-40" : ""}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="flex flex-1 items-center gap-2 text-sm">
        {icon} {label}
      </span>
      <PercentInput value={value} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

function PercentInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode="decimal"
        aria-label={`${label} %`}
        className="w-16 rounded-lg bg-ink-raised px-2 py-1.5 text-right text-sm font-semibold outline-none focus:ring-1 focus:ring-paper/30 disabled:cursor-not-allowed"
      />
      <span className="text-xs text-panda-grey">%</span>
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
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

function HandshakeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m11 17 2 2a1 1 0 0 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 0 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1.4 1.4 0 0 1-2 0L6 8" />
      <path d="M3 8h3l3-3" />
      <path d="M21 16h-2" />
    </svg>
  );
}
