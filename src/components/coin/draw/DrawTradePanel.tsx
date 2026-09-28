"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatPct, formatPrice, formatRelativeTime, formatUsd } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { Coin } from "@/lib/types";
import {
  convertAmount,
  MAX_TRANCHES,
  MIN_TRANCHE_USD,
  pctVsBuy,
  PRICE_IMPACT_HIGH_PCT,
  PRICE_IMPACT_WARN_PCT,
  VOLATILE_LIQUIDITY_USD,
  VOLATILE_PRICE_CHANGE_1H_PCT,
  type FundingAsset,
  type StrategyIssue,
} from "@/lib/strategy/plan";
import type { DrawTarget } from "@/lib/strategy/draw-machine";
import type { RecordGroup } from "./useDrawTrade";
import type { StrategyRecord, StrategyStatus } from "@/lib/strategy/types";
import { lineColor } from "./ChartOverlay";
import { usePriceImpact } from "@/components/coin/usePriceImpact";
import { rememberUnit, sellTargetAt, type BuyUnit, type Draft, type DrawApi, type DraftView } from "./useDrawTrade";

const PAY_WITH: FundingAsset[] = ["SOL", "USDC"];
const STEP_KEYS: Record<string, DictKey> = {
  session: "draw.step.session",
  jupiter: "draw.step.jupiter",
  prepare: "draw.step.prepare",
  sign: "draw.step.sign",
  create: "draw.step.create",
  done: "draw.step.done",
};
// Every sell tranche shares the one "sell" mode/set copy — the tag (e.g. "#1.2") and its own % are what tell them apart.
const MODE_KEYS: Record<DrawTarget, DictKey> = {
  buy: "draw.mode.buy",
  stop: "draw.mode.stop",
  ...Object.fromEntries(Array.from({ length: MAX_TRANCHES }, (_, i) => [`sell${i + 1}`, "draw.mode.sell"])),
} as Record<DrawTarget, DictKey>;
const SET_KEYS: Record<DrawTarget, DictKey> = {
  buy: "draw.set.buy",
  stop: "draw.set.stop",
  ...Object.fromEntries(Array.from({ length: MAX_TRANCHES }, (_, i) => [`sell${i + 1}`, "draw.set.sell"])),
} as Record<DrawTarget, DictKey>;
const STATUS_TONE: Record<StrategyStatus, string> = {
  waiting: "bg-paper/10 text-paper/80",
  buy_triggered: "bg-meme-orange/20 text-meme-orange",
  position_open: "bg-[color:var(--draw-sell)]/20 text-[color:var(--draw-sell)]",
  sell_triggered: "bg-meme-orange/20 text-meme-orange",
  completed: "bg-bamboo/20 text-bamboo",
  failed: "bg-clay-red/20 text-clay-red",
  cancelled: "bg-paper/10 text-panda-grey",
};

const money = (n: number) => `${n < 0 ? "-" : ""}${formatUsd(Math.abs(n))}`;
const signedMoney = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

/** True from the `sm` breakpoint up. The server (and the first paint) assume a desktop. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia("(min-width: 640px)");
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 640px)").matches,
    () => true
  );
}

export default function DrawTradePanel({ draw, coin }: { draw: DrawApi; coin: Coin }) {
  const { t } = useLanguage();
  const target = draw.machine.target;
  const canSell = !!draw.active?.buy;
  const canStop = !!draw.active?.buy;
  const busy = draw.step !== "idle" && draw.step !== "done";
  // The quick "Sell" button in the top bar draws whichever tranche still needs a price (the first one without
  // one), or the first tranche if every one of them already has a price — per-tranche add/remove/% lives on
  // the draft card itself, below.
  const nextSellTarget = draw.active ? sellTargetAt(Math.max(0, draw.active.sells.findIndex((s) => s.price === undefined))) : "sell1";

  // On a phone this section starts folded, so the chart and the buy box sit close together; it opens with a tap (and stays open while a line is being drawn).
  const isDesktop = useIsDesktop();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = !!target || (userOpen ?? isDesktop);
  const count = draw.views.length + draw.recordGroups.length;

  return (
    <section className="mt-4 border-t border-paper/10 pt-4 sm:mt-5 sm:pt-5" aria-labelledby="draw-title">
      <button type="button" onClick={() => setUserOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left sm:hidden">
        <span className="font-display text-base font-bold">
          {t("draw.title")}
          {count > 0 && <span className="ml-2 rounded-full bg-paper/10 px-2 py-0.5 text-[11px] font-medium text-panda-grey">{count}</span>}
        </span>
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`text-panda-grey transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M2 4.5 6 8.5 10 4.5" />
        </svg>
      </button>
      {open && (
      <>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3 sm:mt-0">
        <div className="max-w-md">
          <h2 id="draw-title" className="hidden font-display text-base font-bold sm:block">
            {t("draw.title")}
          </h2>
          <p className="mt-0.5 text-xs text-panda-grey">{t("draw.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TargetButton kind="buy" active={target === "buy"} disabled={busy} onClick={() => draw.startTarget("buy")}>
            {t("draw.setBuy")}
          </TargetButton>
          <TargetButton kind={nextSellTarget} active={target?.startsWith("sell") ?? false} disabled={busy || !canSell} onClick={() => draw.startTarget(nextSellTarget)} title={!canSell ? t("draw.sellNeedsBuy") : undefined}>
            {t("draw.setSell")}
          </TargetButton>
          <TargetButton kind="stop" active={target === "stop"} disabled={busy || !canStop} onClick={() => draw.startTarget("stop")} title={!canStop ? t("draw.sellNeedsBuy") : undefined}>
            {t("draw.setStop")}
          </TargetButton>
          <button
            type="button"
            onClick={draw.addStrategy}
            disabled={busy}
            className="rounded-xl border border-paper/15 px-3.5 py-2 text-xs font-semibold text-paper/80 transition-colors hover:border-paper/35 hover:text-paper disabled:opacity-40"
          >
            {t("draw.add")}
          </button>
        </div>
      </div>

      {target && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-paper/15 bg-ink px-3.5 py-2.5 text-xs" role="status">
          <span className="flex items-start gap-2 text-paper/90">
            <Dot kind={target} />
            {t(MODE_KEYS[target])}
          </span>
          <button type="button" onClick={draw.cancelDrawing} className="shrink-0 font-semibold underline underline-offset-2">
            {t("draw.cancelMode")}
          </button>
        </div>
      )}

      <div aria-live="polite" className="min-h-0">
        {draw.notice && !target && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-paper/10 px-3.5 py-2.5 text-xs font-semibold text-paper">
            <Dot kind={draw.notice.kind} />
            {t(SET_KEYS[draw.notice.kind], { price: formatPrice(draw.notice.price) })}
          </p>
        )}
      </div>

      {draw.views.length > 0 && (
        <div className="mt-4 space-y-3">
          {draw.views.map((v) => (
            <DraftCard key={v.draft.id} view={v} draw={draw} coin={coin} expanded={v.draft.id === draw.activeId} />
          ))}
        </div>
      )}

      {draw.needsSignIn && draw.connected && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-panda-grey">
          {t("draw.signInList")}
          <button type="button" onClick={draw.signIn} className="font-semibold text-meme-orange hover:brightness-110">
            {t("draw.signIn")}
          </button>
        </p>
      )}

      {draw.recordGroups.length > 0 && <SavedStrategies draw={draw} />}

      {draw.error && <ErrorNote error={draw.error} />}
      </>
      )}
    </section>
  );
}

function Dot({ kind }: { kind: DrawTarget }) {
  return <span className="mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: lineColor(kind) }} aria-hidden />;
}

/** Each mode gets its own little bamboo stalk (same colors as its chart line) instead of a plain dot —
 * a small nod to PANDA's bamboo theme on the button that matters most for "drawing your trade". When
 * active, the button itself takes on that color instead of turning plain white. */
function TargetButton({ kind, active, disabled, onClick, title, children }: { kind: DrawTarget; active: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  const color = lineColor(kind);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className="flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={
        active
          ? { borderColor: color, background: `color-mix(in srgb, ${color} 22%, var(--ink-raised))`, color: "var(--paper)" }
          : { borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, color: "color-mix(in srgb, var(--paper) 80%, transparent)" }
      }
    >
      <BambooStalk color={color} />
      {children}
    </button>
  );
}

/** A tiny bamboo culm: a rounded segment with two node rings, in the mode's own color. */
function BambooStalk({ color }: { color: string }) {
  return (
    <svg width="9" height="16" viewBox="0 0 9 16" fill="none" aria-hidden className="shrink-0">
      <rect x="1" y="0.75" width="7" height="14.5" rx="3.5" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.1" />
      <path d="M1 5.4h7M1 10.8h7" stroke={color} strokeWidth="1.1" />
    </svg>
  );
}

/** A small ON/OFF switch — used for "Venta escalonada". */
function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-raised px-3.5 py-2.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-paper">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-panda-grey">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-meme-orange" : "bg-paper/15"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

function ErrorNote({ error }: { error: NonNullable<DrawApi["error"]> }) {
  const { t } = useLanguage();
  const issues = error.issues ?? [];
  return (
    <div className="mt-4 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
      {error.partial ? (
        <p>{t("draw.legPartial", { done: error.partial.done, total: error.partial.total, rolledBack: error.partial.rolledBack ?? 0, stillOpen: error.partial.stillOpen ?? 0 })}</p>
      ) : issues.length > 0 ? (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i}>{t(`draw.issue.${i}` as DictKey)}</li>
          ))}
        </ul>
      ) : error.code === "REJECTED" ? (
        t("draw.err.rejected")
      ) : error.code === "conflict" ? (
        t("draw.err.conflict")
      ) : (
        <>
          {t("draw.err.generic")}
          {error.message && <span className="mt-1 block break-words text-clay-red/80">{error.message.length > 220 ? `${error.message.slice(0, 220)}…` : error.message}</span>}
        </>
      )}
    </div>
  );
}

function DraftCard({ view, draw, coin, expanded }: { view: DraftView; draw: DrawApi; coin: Coin; expanded: boolean }) {
  const { t, lang } = useLanguage();
  const { draft } = view;
  const [ack, setAck] = useState(false);
  const [impactAck, setImpactAck] = useState(false);
  const confirming = draw.step !== "idle" && draw.step !== "done";
  const complete = draft.buy !== undefined && draft.sells.some((s) => s.price !== undefined);

  // A trade this big moves the price — estimated from the coin's own real liquidity, same as a normal buy
  // (TradingPanel.tsx); on-curve = still on Pump.fun's own bonding curve, off-curve = graduated/external, via
  // Jupiter's public quote. Only computed once an amount + funding asset are known.
  const onCurve = coin.source !== "pumpswap" && coin.source !== "other";
  const funding = view.funding?.ok ? view.funding.funding : null;
  const impact = usePriceImpact({
    mint: coin.mint,
    onCurve,
    side: "buy",
    solAmount: onCurve && funding?.asset === "SOL" ? funding.ui : undefined,
    inputMint: !onCurve && funding ? funding.mint : undefined,
    outputMint: !onCurve ? coin.mint : undefined,
    inputAmountRaw: !onCurve && funding ? funding.raw : undefined,
  });
  useEffect(() => {
    Promise.resolve().then(() => setImpactAck(false));
  }, [draft.amount, draft.unit]);

  if (!expanded) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-paper/10 bg-ink px-3.5 py-3 text-xs">
        <div className="min-w-0">
          <p className="font-semibold">
            {t("draw.strategy", { n: draft.n })} <span className="ml-1 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.draft")}</span>
          </p>
          <PriceSummary buy={draft.buy} sells={draft.sells} stop={draft.stop} />
        </div>
        <div className="flex shrink-0 gap-3">
          <button type="button" onClick={() => draw.setActiveId(draft.id)} className="font-semibold text-meme-orange hover:brightness-110">
            {t("draw.edit")}
          </button>
          <button type="button" onClick={() => draw.removeDraft(draft.id)} className="font-semibold text-clay-red hover:brightness-110">
            {t("draw.delete")}
          </button>
        </div>
      </div>
    );
  }

  const pctSum = draft.sells.reduce((s, x) => s + (Number.isFinite(x.pct) ? x.pct : 0), 0);
  const pctOk = Math.round(pctSum) === 100;
  const f = view.funding;
  const rateMissing = f && !f.ok && f.reason === "price_unavailable";
  const short = f && !f.ok && f.reason === "insufficient" ? f.shortfallUsd : undefined;
  const q = draw.quote;
  const rates = { solUsd: q?.solUsd ?? null, usdcUsd: q?.usdcUsd ?? null, eurUsd: q?.eurUsd ?? null };
  const volatile = !!q && ((q.liquidityUsd !== null && q.liquidityUsd < VOLATILE_LIQUIDITY_USD) || (q.priceChangeH1Pct !== null && Math.abs(q.priceChangeH1Pct) > VOLATILE_PRICE_CHANGE_1H_PCT));
  const impactHigh = impact.pct !== null && impact.pct >= PRICE_IMPACT_HIGH_PCT;
  const impactWarn = impact.pct !== null && impact.pct >= PRICE_IMPACT_WARN_PCT;

  // The same amount in the other two currencies, so "10" always means something.
  const cur = (n: number, currency: string) => new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  const others = funding
    ? [
        draft.unit !== "USD" && cur(funding.usd, "USD"),
        draft.unit !== "EUR" && rates.eurUsd && cur(funding.usd / rates.eurUsd, "EUR"),
        draft.unit !== "SOL" && rates.solUsd && `${(funding.usd / rates.solUsd).toLocaleString(lang, { maximumFractionDigits: 4 })} SOL`,
      ].filter(Boolean)
    : [];

  function pickUnit(u: BuyUnit) {
    if (u === draft.unit) return;
    rememberUnit(u);
    const value = parseFloat(draft.amount);
    const converted = value > 0 ? convertAmount(draft.unit, value, u, rates) : null;
    draw.patchDraft(draft.id, { unit: u, amount: converted !== null ? String(Number(converted.toFixed(u === "SOL" ? 4 : 2))) : "" });
  }

  return (
    <div className="rounded-2xl border border-paper/15 bg-ink px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold">
          {t("draw.strategy", { n: draft.n })} <span className="ml-1 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.draft")}</span>
        </p>
        <button type="button" onClick={() => draw.removeDraft(draft.id)} className="text-xs font-semibold text-clay-red hover:brightness-110">
          {t("draw.delete")}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-ink-raised px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] text-panda-grey">
            <Dot kind="buy" />
            {t("draw.label.buy")}
          </span>
          <PriceInput value={draft.buy} label={t("draw.label.buy")} onCommit={(v) => draw.setPrice(draft.id, "buy", v)} />
        </div>
        <div className="rounded-xl bg-ink-raised px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] text-panda-grey">
            <Dot kind="stop" />
            {t("draw.label.stop")}
          </span>
          <PriceInput value={draft.stop} label={t("draw.label.stop")} onCommit={(v) => draw.setPrice(draft.id, "stop", v)} />
        </div>
      </div>
      {draft.stop === undefined && <p className="mt-2 text-[11px] text-panda-grey">{t("draw.stopHint")}</p>}

      <div className="mt-3">
        <Toggle checked={draft.staggered} onChange={(on) => draw.setStaggered(draft.id, on)} disabled={confirming} label={t("draw.staggered.label")} hint={t("draw.staggered.hint")} />
      </div>

      <SellTranches draft={draft} view={view} draw={draw} />
      {draft.staggered && (
        <p className={`mt-2 text-[11px] font-semibold ${pctOk ? "text-bamboo" : "text-clay-red"}`}>{t(pctOk ? "draw.sellPctSumOk" : "draw.sellPctSum", { pct: Math.round(pctSum * 10) / 10 })}</p>
      )}
      {draft.staggered && draft.sells.length > 1 && <p className="mt-1 text-[11px] text-panda-grey">{t("draw.multiSellNote")}</p>}

      {complete && (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink-raised px-3.5 py-2.5 focus-within:border-paper/40">
            <input
              value={draft.amount}
              onChange={(e) => draw.patchDraft(draft.id, { amount: sanitizeDecimalInput(e.target.value) })}
              placeholder="0"
              inputMode="decimal"
              aria-label={t("draw.amount")}
              disabled={confirming}
              className="w-full bg-transparent text-lg font-medium outline-none placeholder:text-panda-grey disabled:opacity-50"
            />
            <div className="flex shrink-0 gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("draw.amount")}>
              {(["SOL", "USD", "EUR"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => pickUnit(u)}
                  aria-pressed={draft.unit === u}
                  aria-label={u}
                  className={`min-w-8 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${draft.unit === u ? "bg-paper text-ink" : "text-panda-grey hover:text-paper"}`}
                >
                  {u === "SOL" ? "SOL" : u === "USD" ? "$" : "€"}
                </button>
              ))}
            </div>
          </div>

          {others.length > 0 && <p className="mt-2 text-xs text-panda-grey">≈ {others.join(" · ≈ ")}</p>}
          {draft.unit !== "SOL" && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-panda-grey">
              <span>{t("draw.payWith")}</span>
              {PAY_WITH.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => draw.patchDraft(draft.id, { pay: a })}
                  aria-pressed={view.asset === a}
                  className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${view.asset === a ? "bg-paper/15 text-paper" : "bg-paper/5 text-paper/70 hover:bg-paper/10"}`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
          {rateMissing && <p className="mt-2 text-xs text-clay-red">{t("draw.noRate")}</p>}
          {short !== undefined && <p className="mt-2 text-xs text-clay-red">{t("draw.notEnough", { short: money(short) })}</p>}

          {impactWarn && (
            <div className={`mt-3 rounded-xl px-3.5 py-2.5 text-xs ${impactHigh ? "bg-clay-red/10 text-clay-red" : "bg-sun/10 text-sun"}`} role="alert">
              <p>{t(impactHigh ? "trading.priceImpactHigh" : "trading.priceImpact", { pct: impact.pct!.toFixed(1) })}</p>
              {impactHigh && (
                <label className="mt-2 flex cursor-pointer items-start gap-2">
                  <input type="checkbox" checked={impactAck} onChange={(e) => setImpactAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--clay-red)]" />
                  <span>{t("trading.priceImpactAck")}</span>
                </label>
              )}
            </div>
          )}
          {impact.exceedsCurve && (
            <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-2.5 text-xs text-clay-red" role="alert">
              {t("trading.exceedsCurve")}
            </p>
          )}

          {view.totalFeeUsd !== null && view.totalNetProfitUsd !== null && view.amountUsd && (
            <>
              <dl className="mt-3 space-y-1.5 rounded-xl bg-ink-raised px-3.5 py-3 text-xs">
                <Row label={t("draw.fee")} value={`+ ${money(view.totalFeeUsd)}`} muted />
                <Row label={t("draw.total")} value={money(view.amountUsd + view.totalFeeUsd)} strong />
                <div className="border-t border-paper/10 pt-1.5" />
                <Row
                  label={t("draw.ifSell")}
                  value={`${signedMoney(view.totalNetProfitUsd)} (${formatPct((view.totalNetProfitUsd / view.amountUsd) * 100)})`}
                  tone={view.totalNetProfitUsd >= 0 ? "text-bamboo" : "text-clay-red"}
                  strong
                />
                {view.legMetrics.length > 1 && (
                  <div className="space-y-1 pl-2 text-[11px] text-panda-grey">
                    {view.legMetrics.map((lm, i) => lm && <Row key={i} label={t("draw.sellN", { n: i + 1 })} value={`${signedMoney(lm.netProfitUsd)} (${formatPct(lm.pct)})`} tone={lm.netProfitUsd >= 0 ? "text-bamboo" : "text-clay-red"} />)}
                  </div>
                )}
                <Row
                  label={t("draw.stopResult")}
                  value={signedMoney(view.legMetrics.reduce((s, lm) => s + (lm?.netStopLossUsd ?? 0), 0))}
                  tone="text-clay-red"
                />
              </dl>
              <p className="mt-1.5 text-[11px] text-panda-grey">{t("draw.estimateShort")} {t("draw.feeNote")}</p>
            </>
          )}

          {view.issues.length > 0 && draft.amount !== "" && (
            <ul className="mt-3 space-y-1 text-xs text-clay-red" role="alert">
              {view.issues.map((i: StrategyIssue) => (
                <li key={i}>{t(`draw.issue.${i}` as DictKey)}</li>
              ))}
            </ul>
          )}

          {funding && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-paper/80">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--meme-orange)]" />
              <span>{t("draw.custodyShort")}</span>
            </label>
          )}

          {!draw.engine && <p className="mt-3 text-xs text-panda-grey">{t("draw.engineOffShort")}</p>}
          {!draw.connected && <p className="mt-3 text-xs text-panda-grey">{t("draw.connect")}</p>}

          {/* Fixed, always visible right above the confirm button — never conditional. */}
          <p className="mt-3 text-[11px] text-panda-grey">{t("draw.execution.notice")}</p>
          {volatile && (
            <p className="mt-1.5 rounded-xl bg-clay-red/10 px-3 py-2 text-[11px] font-semibold text-clay-red" role="alert">
              {t("draw.execution.volatile")}
            </p>
          )}

          <button
            type="button"
            onClick={() => draw.confirm(view)}
            disabled={!view.ready || !draw.engine || !draw.connected || !ack || confirming || (impactHigh && !impactAck)}
            className="mt-3 w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirming || draw.step === "done" ? t(STEP_KEYS[draw.step]) : t("draw.confirm")}
          </button>
          {confirming && draw.legProgress && draw.legProgress.total > 1 && (
            <p className="mt-1.5 text-center text-[11px] text-panda-grey">{t("draw.legProgress", { n: draw.legProgress.index + 1, m: draw.legProgress.total })}</p>
          )}
        </>
      )}
    </div>
  );
}

/** With "Venta escalonada" off: the plain single Sell + Stop box, exactly as before. On: every tranche gets
 *  its own price + % of the position, "+ venta" capped by MIN_TRANCHE_USD ($11) worth of headroom. */
function SellTranches({ draft, view, draw }: { draft: Draft; view: DraftView; draw: DrawApi }) {
  const { t } = useLanguage();
  const atCap = draft.sells.length >= view.maxTranchesAllowed || draft.sells.length >= MAX_TRANCHES;
  return (
    <div className="mt-2 space-y-2">
      {draft.sells.map((s, i) => {
        const target = sellTargetAt(i);
        const pct = pctVsBuy(s.price ?? 0, draft.buy);
        const tooSmall = view.trancheTooSmall[i];
        return (
          <div key={i}>
            <div className="flex items-center gap-2 rounded-xl bg-ink-raised px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] text-panda-grey">
                  <Dot kind={target} />
                  {draft.staggered ? t("draw.sellN", { n: i + 1 }) : t("draw.label.sell")}
                  {s.price !== undefined && pct !== null && <span className={pct >= 0 ? "text-bamboo" : "text-clay-red"}>{formatPct(pct)}</span>}
                </span>
                <PriceInput value={s.price} label={t("draw.sellN", { n: i + 1 })} onCommit={(v) => draw.setPrice(draft.id, target, v)} />
              </div>
              {draft.staggered && (
                <div className="shrink-0 text-right">
                  <label className="sr-only" htmlFor={`sell-pct-${draft.id}-${i}`}>
                    {t("draw.sellPctOfPosition")}
                  </label>
                  <input
                    id={`sell-pct-${draft.id}-${i}`}
                    value={s.pct}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (Number.isFinite(n)) draw.setSellPct(draft.id, i, Math.max(0, Math.min(100, n)));
                    }}
                    inputMode="numeric"
                    className={`w-12 rounded-lg bg-ink px-1.5 py-1 text-right text-xs font-semibold outline-none ${tooSmall ? "text-clay-red" : ""}`}
                  />
                  <span className="ml-0.5 text-xs text-panda-grey">%</span>
                </div>
              )}
              {draft.staggered && draft.sells.length > 1 && (
                <button type="button" onClick={() => draw.removeSellTranche(draft.id, i)} aria-label={t("draw.removeSell")} className="shrink-0 text-panda-grey hover:text-clay-red">
                  ×
                </button>
              )}
            </div>
            {tooSmall && view.amountUsd !== null && (
              <p className="mt-1 pl-1 text-[11px] text-clay-red">{t("draw.tranche.tooSmall", { usd: money((view.amountUsd * s.pct) / 100), min: money(MIN_TRANCHE_USD) })}</p>
            )}
          </div>
        );
      })}
      {draft.staggered && (
        <>
          <button
            type="button"
            onClick={() => draw.addSellTranche(draft.id, view.maxTranchesAllowed)}
            disabled={atCap}
            className="text-xs font-semibold text-meme-orange hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("draw.addSell")}
          </button>
          {atCap && view.maxTranchesAllowed < MAX_TRANCHES && <p className="text-[11px] text-panda-grey">{t("draw.tranche.maxReached", { n: view.maxTranchesAllowed, min: money(MIN_TRANCHE_USD) })}</p>}
        </>
      )}
    </div>
  );
}

function Row({ label, value, tone, muted, strong }: { label: string; value: string; tone?: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-panda-grey">{label}</dt>
      <dd className={`text-right ${strong ? "font-bold" : "font-medium"} ${tone ?? (muted ? "text-panda-grey" : "text-paper")}`}>{value}</dd>
    </div>
  );
}

function PriceSummary({ buy, sells, stop }: { buy?: number; sells: { price?: number; pct: number }[]; stop?: number }) {
  const { t } = useLanguage();
  const sellText = sells
    .map((s, i) => (s.price ? `${sells.length > 1 ? `#${i + 1} ` : ""}${formatPrice(s.price)}` : "—"))
    .join(" / ");
  return (
    <p className="mt-0.5 text-panda-grey">
      <span style={{ color: lineColor("buy") }}>{t("draw.line.buy")}</span> {buy ? formatPrice(buy) : "—"} → <span style={{ color: lineColor("sell1") }}>{t("draw.line.sell")}</span> {sellText}
      {stop ? (
        <>
          {" · "}
          <span style={{ color: lineColor("stop") }}>{t("draw.line.stop")}</span> {formatPrice(stop)}
        </>
      ) : null}
    </p>
  );
}

/** The price as plain digits (never "4.3e-7"), so it can be read and edited by hand. */
function plainPrice(p: number): string {
  const decimals = Math.min(18, Math.max(2, -Math.floor(Math.log10(p)) + 3));
  return p.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Prices are normally drawn on the chart; this box is the same thing by hand. Applied on Enter or when leaving the box. */
function PriceInput({ value, label, onCommit }: { value?: number; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null) onCommit(text);
    setText(null);
  };
  return (
    <input
      value={text ?? (value !== undefined ? plainPrice(value) : "")}
      onChange={(e) => setText(sanitizeDecimalInput(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      inputMode="decimal"
      placeholder="—"
      aria-label={`${label} (USD)`}
      className="mt-1 w-full bg-transparent text-sm font-semibold outline-none placeholder:text-panda-grey"
    />
  );
}

function SavedStrategies({ draw }: { draw: DrawApi }) {
  const { t, lang } = useLanguage();
  const last = Math.max(0, ...draw.records.map((r) => r.lastSyncAt ?? 0));
  const anyLive = draw.records.some((r) => !["completed", "failed", "cancelled"].includes(r.state));
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-paper/80">{t("draw.saved")}</p>
        {anyLive && (
          <button type="button" onClick={draw.sync} disabled={draw.syncing} className="text-xs font-semibold text-meme-orange hover:brightness-110 disabled:opacity-50">
            {draw.syncing ? t("draw.refreshing") : t("draw.refresh")}
          </button>
        )}
      </div>
      {anyLive && (
        <p className="mt-1 text-[11px] text-panda-grey">
          {last ? t("draw.lastCheck", { time: formatRelativeTime(last, lang) }) : t("draw.neverChecked")} · {t("draw.refreshWhy")}
        </p>
      )}
      <div className="mt-2 space-y-2.5">
        {draw.recordGroups.map((g) => (
          <RecordGroupCard key={g.groupId} group={g} draw={draw} />
        ))}
      </div>
    </div>
  );
}

/** One card per drawn position, even when it's several real tranches underneath (see useDrawTrade.ts's
 *  `recordGroups`) — the header shows it as ONE operation; each tranche still gets its own status/tx/cancel,
 *  since each really is its own independent order on Jupiter. */
function RecordGroupCard({ group, draw }: { group: RecordGroup; draw: DrawApi }) {
  const { t } = useLanguage();
  const legs = group.legs;
  const first = legs[0];
  const totalAmountUsd = legs.reduce((s, l) => s + l.amountUsd, 0);
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink px-3.5 py-3 text-xs">
      <div className="min-w-0">
        <p className="font-semibold">
          {t("draw.strategy", { n: group.n })}
          {legs.length > 1 && <span className="ml-1.5 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.tranches", { n: legs.length })}</span>}
        </p>
        <PriceSummary buy={first.buyUsd} sells={legs.map((l) => ({ price: l.sellUsd, pct: l.legPct ?? 100 }))} stop={first.stopUsd} />
        <p className="mt-0.5 text-panda-grey">
          {money(totalAmountUsd)} · {first.fundingAsset} → ${first.ticker}
        </p>
      </div>
      <div className="mt-2 space-y-2">
        {legs.map((r, i) => (
          <LegRow key={r.id} r={r} showIndex={legs.length > 1} index={i} draw={draw} />
        ))}
      </div>
    </div>
  );
}

/** One tranche's own status/tx-links/cancel, inside its group's card. */
function LegRow({ r, showIndex, index, draw }: { r: StrategyRecord; showIndex: boolean; index: number; draw: DrawApi }) {
  const { t } = useLanguage();
  const status = r.state as StrategyStatus;
  const live = !["completed", "failed", "cancelled"].includes(r.state);
  const helpKey = `draw.help.${status}` as DictKey;
  const hasHelp = ["waiting", "buy_triggered", "position_open", "sell_triggered", "cancelled"].includes(status);
  return (
    <div className={showIndex ? "border-t border-paper/10 pt-2 first:border-t-0 first:pt-0" : undefined}>
      <div className="flex items-start justify-between gap-3">
        {showIndex && <span className="shrink-0 text-panda-grey">{t("draw.sellN", { n: index + 1 })}</span>}
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[status]} ${showIndex ? "" : "ml-auto"}`}>{t(`draw.status.${status}` as DictKey)}</span>
      </div>
      {hasHelp && <p className="mt-1 text-panda-grey">{t(helpKey, { price: formatPrice(r.buyUsd) })}</p>}
      {status === "completed" && <p className="mt-1 text-panda-grey">{r.sellKind === "stop_loss" ? t("draw.closedStop") : t("draw.closedTarget")}</p>}
      {status === "failed" && r.error && <p className="mt-1 break-words text-clay-red">{r.error}</p>}
      {r.holdsTokens && <p className="mt-1 text-meme-orange">{t("draw.holds")}</p>}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3">
          {r.buySignature && (
            <a href={`https://solscan.io/tx/${r.buySignature}`} target="_blank" rel="noreferrer" className="text-bamboo hover:underline">
              {t("draw.txBuy")}
            </a>
          )}
          {r.sellSignature && (
            <a href={`https://solscan.io/tx/${r.sellSignature}`} target="_blank" rel="noreferrer" className="text-bamboo hover:underline">
              {t("draw.txSell")}
            </a>
          )}
        </div>
        {live && (
          <button type="button" onClick={() => draw.cancelLive(r)} disabled={draw.cancelling === r.id} className="font-semibold text-clay-red hover:brightness-110 disabled:opacity-50">
            {draw.cancelling === r.id ? t("draw.cancelling") : t("draw.cancelStrategy")}
          </button>
        )}
      </div>
    </div>
  );
}
