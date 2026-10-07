"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatPct, formatPrice, formatRelativeTime, formatUsd } from "@/lib/format";
import { type KindIssue } from "@/lib/strategy/kinds";
import { needsNoStopNotice, summaryParts, trancheSummaryParts, type SummaryPart } from "@/lib/strategy/summary";
import { canAddPct, PCT_MORE_PRESETS, PCT_PRESETS, type Tranche } from "@/lib/strategy/allocation";
import type { Draft, TrancheView } from "./useDrawTrade";
import { formatDisplayValue, parseDisplayValue, sanitizeDisplayInput } from "@/lib/strategy/display";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import type { Coin } from "@/lib/types";
import {
  convertAmount,
  pctVsBuy,
  PRICE_IMPACT_HIGH_PCT,
  PRICE_IMPACT_WARN_PCT,
  VOLATILE_LIQUIDITY_USD,
  VOLATILE_PRICE_CHANGE_1H_PCT,
  type FundingAsset,
} from "@/lib/strategy/plan";
import type { DrawTarget } from "@/lib/strategy/draw-machine";
import type { RecordGroup } from "./useDrawTrade";
import type { StrategyRecord, StrategyStatus } from "@/lib/strategy/types";
import { lineColor } from "./ChartOverlay";
import { usePriceImpact } from "@/components/coin/usePriceImpact";
import { rememberUnit, type BuyUnit, type DrawApi, type DraftView } from "./useDrawTrade";

const PAY_WITH: FundingAsset[] = ["SOL", "USDC"];
const STEP_KEYS: Record<string, DictKey> = {
  session: "draw.step.session",
  jupiter: "draw.step.jupiter",
  prepare: "draw.step.prepare",
  sign: "draw.step.sign",
  create: "draw.step.create",
  cancel: "draw.step.cancel",
  done: "draw.step.done",
};
// Only "buy" / "sell1" / "stop" are ever placed on a new draft now — the other sell slots in DrawTarget exist
// only to address an OLD, legacy multi-tranche strategy's own saved lines (see useDrawTrade.ts), never drawn by hand.
const MODE_KEYS: Record<DrawTarget, DictKey> = { buy: "draw.mode.buy", stop: "draw.mode.stop" } as Record<DrawTarget, DictKey>;
const SET_KEYS: Record<DrawTarget, DictKey> = { buy: "draw.set.buy", stop: "draw.set.stop" } as Record<DrawTarget, DictKey>;
MODE_KEYS.sell1 = "draw.mode.sell";
SET_KEYS.sell1 = "draw.set.sell";
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

/** Price vs. market cap — whichever the chart's own selector is showing right now (see PriceChart.tsx). Every
 *  row here reads/writes in this same unit, but always converts back to real USD underneath (`fromDisplay`)
 *  before it ever reaches a draft, the validation, or the server — the display unit is presentation only. */
type DisplayApi = { unit: "price" | "mcap"; toDisplay: (usd: number) => number; fromDisplay: (v: number) => number; formatValue: (usd: number) => string };

export default function DrawTradePanel({ draw, coin, unit, toDisplay, fromDisplay, formatValue }: { draw: DrawApi; coin: Coin } & DisplayApi) {
  const { t } = useLanguage();
  const target = draw.machine.target;
  const canSell = !!draw.active?.buy;
  const busy = draw.step !== "idle" && draw.step !== "done";

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
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 sm:mt-0">
        <div>
          <h2 id="draw-title" className="hidden font-display text-base font-bold sm:block">
            {t("draw.title")}
          </h2>
          <p className="mt-0.5 text-xs text-panda-grey">{t("draw.subtitle")}</p>
        </div>
        <button type="button" onClick={draw.addStrategy} disabled={busy} className="text-xs font-semibold text-meme-orange transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          {t("draw.add")}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <TargetTabs target={target} canSell={canSell} busy={busy} onPick={draw.startTarget} disabledTitle={t("draw.sellNeedsBuy")} />
        {target && (
          <button type="button" onClick={draw.cancelDrawing} className="text-xs font-semibold text-panda-grey underline underline-offset-2 hover:text-paper">
            {t("draw.cancelMode")}
          </button>
        )}
      </div>

      {target ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-paper/80" role="status">
          <Dot kind={target} />
          {t(MODE_KEYS[target])}
        </p>
      ) : (
        !canSell && (
          // A `title` tooltip never shows on a touch tap, so without this a phone gives zero explanation
          // for why "Venta"/"Stop" look disabled — this is always visible instead, on every device.
          <p className="mt-2 text-xs text-panda-grey">{t("draw.sellNeedsBuy")}</p>
        )
      )}

      <div aria-live="polite" className="min-h-0">
        {draw.notice && !target && (
          <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-paper">
            <Dot kind={draw.notice.kind} />
            {t(SET_KEYS[draw.notice.kind], { price: formatValue(draw.notice.price) })}
          </p>
        )}
      </div>

      {draw.views.length > 0 && (
        <div className="mt-4">
          {draw.views.map((v, i) => (
            <div key={v.draft.id} className={i > 0 ? "border-t border-paper/10 pt-4 mt-4" : undefined}>
              <DraftBlock view={v} draw={draw} coin={coin} expanded={v.draft.id === draw.activeId} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} formatValue={formatValue} />
            </div>
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

      {draw.recordGroups.length > 0 && <SavedStrategies draw={draw} formatValue={formatValue} />}

      {draw.error && <ErrorNote error={draw.error} />}
      </>
      )}
    </section>
  );
}

function Dot({ kind }: { kind: DrawTarget }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: lineColor(kind) }} aria-hidden />;
}

/** Small segmented control — "Compra · Venta · Stop" — picks which line the next click/tap on the chart
 *  places. Each tab takes on its own line's color when active, a quiet nod to the chart below it. */
function TargetTabs({ target, canSell, busy, onPick, disabledTitle }: { target: DrawTarget | null; canSell: boolean; busy: boolean; onPick: (t: DrawTarget) => void; disabledTitle: string }) {
  const { t } = useLanguage();
  const tabs: { key: DrawTarget; labelKey: DictKey }[] = [
    { key: "buy", labelKey: "draw.line.buy" },
    { key: "sell1", labelKey: "draw.line.sell" },
    { key: "stop", labelKey: "draw.line.stop" },
  ];
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("draw.title")}>
      {tabs.map(({ key, labelKey }) => {
        const disabled = busy || (key !== "buy" && !canSell);
        const active = target === key || (key === "sell1" && !!target?.startsWith("sell"));
        const color = lineColor(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            disabled={disabled}
            title={disabled && !busy ? disabledTitle : undefined}
            aria-pressed={active}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={active ? { background: color, color: "var(--ink)" } : { color: "color-mix(in srgb, var(--paper) 75%, transparent)" }}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function ErrorNote({ error }: { error: NonNullable<DrawApi["error"]> }) {
  const { t } = useLanguage();
  const issues = error.issues ?? [];
  return (
    <div className="mt-4 rounded-xl bg-clay-red/10 px-3.5 py-3 text-xs text-clay-red" role="alert">
      {issues.length > 0 ? (
        <ul className="space-y-1">
          {issues.map((i) => (
            <li key={i}>{t(`draw.issue.${i}` as DictKey)}</li>
          ))}
        </ul>
      ) : error.code === "REJECTED" ? (
        t("draw.err.rejected")
      ) : error.code === "conflict" ? (
        t("draw.err.conflict")
      ) : error.code === "BATCH_ROLLED_BACK" ? (
        t("draw.err.batchRolledBack")
      ) : (
        <>
          {t("draw.err.generic")}
          {error.message && <span className="mt-1 block break-words text-clay-red/80">{error.message.length > 220 ? `${error.message.slice(0, 220)}…` : error.message}</span>}
        </>
      )}
    </div>
  );
}

function DraftBlock({ view, draw, coin, expanded, unit, toDisplay, fromDisplay, formatValue }: { view: DraftView; draw: DrawApi; coin: Coin; expanded: boolean } & DisplayApi) {
  const { t, lang } = useLanguage();
  const { draft } = view;
  const [ack, setAck] = useState(false);
  const [impactAck, setImpactAck] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const confirming = draw.step !== "idle" && draw.step !== "done";
  // A held-coin draft (no buy leg) is governed entirely by its percentage tranches now — see TrancheEditor
  // below; a buy-including draft is complete once its legs make one of the two offered shapes (kinds.ts).
  const heldMode = draft.buy === undefined;
  const complete = heldMode ? view.tranches.length > 0 : view.kind !== null;

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
      <div className="flex items-center justify-between gap-3 py-1 text-xs">
        <div className="min-w-0">
          <p className="font-semibold">
            {t("draw.strategy", { n: draft.n })} <span className="ml-1 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.draft")}</span>
          </p>
          <SummaryLine parts={draft.buy === undefined ? trancheSummaryParts(draft.tranches ?? []) : summaryParts({ buy: draft.buy, sell: draft.sell, stop: draft.stop }, 100)} formatValue={formatValue} />
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

  const sellPct = draft.sell !== undefined ? pctVsBuy(draft.sell, draft.buy) : null;
  const stopPct = draft.stop !== undefined ? pctVsBuy(draft.stop, draft.buy) : null;
  const f = view.funding;
  const rateMissing = f && !f.ok && f.reason === "price_unavailable";
  const short = f && !f.ok && f.reason === "insufficient" ? f.shortfallUsd : undefined;
  const q = draw.quote;
  const rates = { solUsd: q?.solUsd ?? null, usdcUsd: q?.usdcUsd ?? null, eurUsd: q?.eurUsd ?? null };
  const volatile = !!q && ((q.liquidityUsd !== null && q.liquidityUsd < VOLATILE_LIQUIDITY_USD) || (q.priceChangeH1Pct !== null && Math.abs(q.priceChangeH1Pct) > VOLATILE_PRICE_CHANGE_1H_PCT));
  const impactHigh = impact.pct !== null && impact.pct >= PRICE_IMPACT_HIGH_PCT;
  const impactWarn = impact.pct !== null && impact.pct >= PRICE_IMPACT_WARN_PCT;

  // One discrete line above the confirm button — the single most relevant thing to say right now, instead of
  // a stack of separate warning boxes. Falls back to the plain, always-true execution notice.
  const notice: { text: string; tone: string } =
    short !== undefined
      ? { text: t("draw.notEnough", { short: money(short) }), tone: "text-clay-red font-semibold" }
      : rateMissing
      ? { text: t("draw.noRate"), tone: "text-clay-red font-semibold" }
      : impact.exceedsCurve
      ? { text: t("trading.exceedsCurve"), tone: "text-clay-red font-semibold" }
      : impactHigh
      ? { text: t("trading.priceImpactHigh", { pct: impact.pct!.toFixed(1) }), tone: "text-clay-red font-semibold" }
      : impactWarn
      ? { text: t("trading.priceImpact", { pct: impact.pct!.toFixed(1) }), tone: "text-sun font-semibold" }
      : volatile
      ? { text: t("draw.execution.volatile"), tone: "text-clay-red font-semibold" }
      : !draw.engine
      ? { text: t("draw.engineOffShort"), tone: "text-panda-grey" }
      : !draw.connected
      ? { text: t("draw.connect"), tone: "text-panda-grey" }
      : { text: t("draw.execution.notice"), tone: "text-panda-grey" };

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
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold">
          {t("draw.strategy", { n: draft.n })} <span className="ml-1 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.draft")}</span>
        </p>
        <button type="button" onClick={() => draw.removeDraft(draft.id)} className="text-xs font-semibold text-clay-red hover:brightness-110">
          {t("draw.delete")}
        </button>
      </div>

      {/* A buy-including draft: three clean rows, a dot, the name, the price (or market cap — whatever the
          chart shows now) and the live % vs. the buy target. Tap the number to edit it by hand. A held-coin
          draft (no buy) uses the percentage tranche editor below instead — there is no bare, un-allocated
          sell/stop any more, every exit is a % of the position. */}
      {!heldMode && (
        <div className="mt-2">
          <LineRow kind="buy" label={t("draw.line.buy")} value={draft.buy} pct={null} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} onCommit={(v) => draw.setPrice(draft.id, "buy", v)} onClear={() => draw.clearLeg(draft.id, "buy")} clearLabel={t("draw.clearLeg")} />
          <LineRow kind="sell1" label={t("draw.line.sell")} value={draft.sell} pct={sellPct} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} onCommit={(v) => draw.setPrice(draft.id, "sell1", v)} onClear={draft.sell !== undefined ? () => draw.clearLeg(draft.id, "sell1") : undefined} clearLabel={t("draw.clearLeg")} />
          <LineRow kind="stop" label={t("draw.line.stop")} value={draft.stop} pct={stopPct} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} onCommit={(v) => draw.setPrice(draft.id, "stop", v)} onClear={draft.stop !== undefined ? () => draw.clearLeg(draft.id, "stop") : undefined} clearLabel={t("draw.clearLeg")} last />
        </div>
      )}
      {heldMode && <TrancheEditor draft={draft} view={view} draw={draw} coin={coin} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} />}
      {!heldMode && needsNoStopNotice({ buy: draft.buy, sell: draft.sell, stop: draft.stop }) && <p className="mt-2 text-[11px] text-panda-grey">{t("draw.noStopWarning")}</p>}

      {complete && (
        <>
          {heldMode ? (
            <div className="mt-3 text-xs font-medium text-paper/90">
              <SummaryLine parts={trancheSummaryParts(draft.tranches ?? [])} formatValue={formatValue} />
            </div>
          ) : (
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

          </>
          )}

          {/* One-line summary; the fee/total breakdown stays folded until asked for. */}
          {view.metrics !== null && view.amountUsd && (
            <>
              <p className="mt-3 text-xs font-medium text-paper/90">
                {t("draw.summary", {
                  sell: `${signedMoney(view.metrics.netProfitUsd)} (${formatPct(view.metrics.pct)})`,
                  stop: signedMoney(view.metrics.netStopLossUsd),
                })}
              </p>
              <button type="button" onClick={() => setDetailOpen((v) => !v)} className="mt-1 text-[11px] font-semibold text-meme-orange hover:brightness-110">
                {t(detailOpen ? "draw.detail.hide" : "draw.detail.show")}
              </button>
              {detailOpen && (
                <dl className="mt-2 space-y-1.5 rounded-xl bg-ink-raised px-3.5 py-3 text-xs">
                  <Row label={t("draw.fee")} value={`+ ${money(view.metrics.feeUsd)}`} muted />
                  <Row label={t("draw.total")} value={money(view.amountUsd + view.metrics.feeUsd)} strong />
                </dl>
              )}
              <p className="mt-1 text-[11px] text-panda-grey">{t("draw.estimateShort")}</p>
            </>
          )}

          {view.issues.length > 0 && draft.amount !== "" && (
            <ul className="mt-3 space-y-1 text-xs text-clay-red" role="alert">
              {view.issues.map((i: KindIssue) => (
                <li key={i}>{t(`draw.issue.${i}` as DictKey)}</li>
              ))}
            </ul>
          )}

          {(funding || heldMode) && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-paper/80">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--meme-orange)]" />
              <span>{t("draw.custodyShort")}</span>
            </label>
          )}

          {/* Fixed, always visible right above the confirm button — one discrete line, never a stack of boxes. */}
          <p className={`mt-3 text-[11px] ${notice.tone}`} role={notice.tone.includes("clay-red") ? "alert" : undefined}>
            {notice.text}
          </p>
          {impactHigh && (
            <label className="mt-1.5 flex cursor-pointer items-start gap-2 text-[11px] text-clay-red">
              <input type="checkbox" checked={impactAck} onChange={(e) => setImpactAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--clay-red)]" />
              <span>{t("trading.priceImpactAck")}</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => (heldMode ? draw.confirmTranches(view) : draw.confirm(view))}
            disabled={!view.ready || !draw.engine || !draw.connected || !ack || confirming || (!heldMode && impactHigh && !impactAck)}
            className="mt-3 w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirming || draw.step === "done" ? `${t(STEP_KEYS[draw.step])}${draw.batchProgress ? ` (${draw.batchProgress.done}/${draw.batchProgress.total})` : ""}` : t("draw.confirm")}
          </button>
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

type PriceDisplayApi = Pick<DisplayApi, "unit" | "toDisplay" | "fromDisplay">;

/** One row: a colored dot, the line's name, its live % vs. the buy target (when it has one), and its
 *  price/market cap — tap the number to edit it by hand, same as drawing it on the chart. */
function LineRow({ kind, label, value, pct, unit, toDisplay, fromDisplay, onCommit, onClear, clearLabel, disabledReason, last }: { kind: DrawTarget; label: string; value?: number; pct: number | null; onCommit: (v: string) => void; onClear?: () => void; clearLabel: string; disabledReason?: string; last?: boolean } & PriceDisplayApi) {
  return (
    <div className={`py-2 ${last ? "" : "border-b border-paper/10"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-panda-grey">
          <Dot kind={kind} />
          {label}
        </span>
        <span className="flex items-center gap-2">
          {pct !== null && <span className={`text-xs font-medium ${pct >= 0 ? "text-bamboo" : "text-clay-red"}`}>{formatPct(pct)}</span>}
          <UnitAwarePriceInput value={value} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} label={label} onCommit={onCommit} disabled={!!disabledReason} />
          {onClear && (
            <button type="button" onClick={onClear} aria-label={clearLabel} title={clearLabel} className="flex h-8 w-8 items-center justify-center rounded-full text-sm text-panda-grey transition hover:text-clay-red">
              <span aria-hidden>×</span>
            </button>
          )}
        </span>
      </div>
      {disabledReason && <p className="mt-1 text-right text-[11px] text-clay-red">{disabledReason}</p>}
    </div>
  );
}

/**
 * "Venta por porcentaje dibujando": pick a % (a preset, or "Otro" for a free 1–100 value), then click/tap the
 * chart at the price to place that tranche's line — repeatable at several price levels, capped at 100% of
 * the balance in total (allocation.ts). Mouse and touch both already go through the exact same gesture (see
 * useDrawTrade.ts's onPointer/startTranchePlacement), so nothing here needs to know which one is in use.
 */
function TrancheEditor({ draft, view, draw, coin, unit, toDisplay, fromDisplay }: { draft: Draft; view: DraftView; draw: DrawApi; coin: Coin } & PriceDisplayApi) {
  const { t } = useLanguage();
  const tranches = draft.tranches ?? [];
  // Not yet known (null, still loading) is never treated as "none" — only a real, read balance of 0 or less is.
  const noCoin = view.tokenBalance !== null && view.tokenBalance <= 0;
  return (
    <div className="mt-2 space-y-3">
      {noCoin ? (
        <p className="text-xs text-panda-grey">{t("draw.noToken", { ticker: coin.ticker })}</p>
      ) : (
        <>
          <PctRow legLabel={t("draw.line.sell")} dotKind="sell1" leg="sell" draftId={draft.id} tranches={tranches} draw={draw} />
          <PctRow legLabel={t("draw.line.stop")} dotKind="stop" leg="stop" draftId={draft.id} tranches={tranches} draw={draw} />
          <p className="text-[11px] text-panda-grey">{t("draw.remainingPct", { pct: view.remainingPct })}</p>
        </>
      )}
      {view.tranches.length > 0 && (
        <div className="space-y-1.5">
          {view.tranches.map((tv) => (
            <TrancheLegRows key={tv.tranche.id} tv={tv} draftId={draft.id} draw={draw} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One leg's quick picks ("Venta"/"Stop"): the 4 main presets always shown, "Más ▾" unfolding 5/10/15/"Otro"
 *  (a free 1–100 entry) — folds back up the moment a value is picked. Picking an enabled % arms the chart for
 *  the NEXT click/tap (DrawTradePanel never places a price itself). */
function PctRow({ legLabel, dotKind, leg, draftId, tranches, draw }: { legLabel: string; dotKind: DrawTarget; leg: "sell" | "stop"; draftId: string; tranches: Tranche[]; draw: DrawApi }) {
  const { t } = useLanguage();
  const [more, setMore] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState("");
  const armed = draw.machine.target === dotKind;
  const pick = (pct: number) => {
    draw.startTranchePlacement(draftId, leg, pct);
    setMore(false);
    setOtherOpen(false);
    setOtherValue("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="flex items-center gap-1.5 text-panda-grey">
        <Dot kind={dotKind} />
        {legLabel}
      </span>
      {PCT_PRESETS.map((pct) => (
        <PctButton key={pct} pct={pct} tranches={tranches} onPick={pick} />
      ))}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="rounded-full bg-paper/5 px-2.5 py-1 font-semibold text-paper/70 transition-colors hover:bg-paper/10"
        >
          {t("draw.more")} ▾
        </button>
        {more && (
          <div className="absolute left-0 top-full z-10 mt-1 flex min-w-[88px] flex-col gap-1 rounded-xl border border-paper/10 bg-ink-raised p-2 shadow-lg">
            {PCT_MORE_PRESETS.map((pct) => (
              <PctButton key={pct} pct={pct} tranches={tranches} onPick={pick} full />
            ))}
            {otherOpen ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={otherValue}
                  onChange={(e) => setOtherValue(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  placeholder={t("draw.otherPlaceholder")}
                  inputMode="numeric"
                  aria-label={t("draw.other")}
                  className="w-12 rounded-lg bg-ink px-2 py-1 text-xs outline-none placeholder:text-panda-grey"
                />
                <button
                  type="button"
                  onClick={() => {
                    const n = parseInt(otherValue, 10);
                    if (n >= 1 && n <= 100 && canAddPct(tranches, n)) pick(n);
                  }}
                  className="rounded-lg bg-paper px-2 py-1 text-xs font-semibold text-ink"
                >
                  {t("draw.apply")}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setOtherOpen(true)} className="rounded-full bg-paper/5 px-2.5 py-1 text-left font-semibold text-paper/70 hover:bg-paper/10">
                {t("draw.other")}
              </button>
            )}
          </div>
        )}
      </div>
      {armed && <span className="text-meme-orange">{t("draw.tapChart")}</span>}
    </div>
  );
}

function PctButton({ pct, tranches, onPick, full }: { pct: number; tranches: Tranche[]; onPick: (pct: number) => void; full?: boolean }) {
  const ok = canAddPct(tranches, pct);
  return (
    <button
      type="button"
      onClick={() => ok && onPick(pct)}
      disabled={!ok}
      className={`rounded-full bg-paper/5 px-2.5 py-1 font-semibold text-paper/80 transition-colors hover:bg-paper/10 disabled:cursor-not-allowed disabled:opacity-40 ${full ? "text-left" : ""}`}
    >
      {pct}%
    </button>
  );
}

/** One tranche's own line(s) — ONE row per leg it actually has, so a paired (sell+stop) tranche shows two,
 *  each independently editable/removable, sharing the SAME % (allocation.ts pairs them into one "oco" order). */
function TrancheLegRows({ tv, draftId, draw, unit, toDisplay, fromDisplay }: { tv: TrancheView; draftId: string; draw: DrawApi } & PriceDisplayApi) {
  const { t } = useLanguage();
  const tr = tv.tranche;
  const legs: { leg: "sell" | "stop"; price: number; dotKind: DrawTarget; labelKey: DictKey }[] = [];
  if (tr.sell !== undefined) legs.push({ leg: "sell", price: tr.sell, dotKind: "sell1", labelKey: "draw.line.sell" });
  if (tr.stop !== undefined) legs.push({ leg: "stop", price: tr.stop, dotKind: "stop", labelKey: "draw.line.stop" });
  return (
    <div className="rounded-xl bg-ink-raised px-3 py-2">
      {legs.map((l, i) => (
        <div key={l.leg} className={`flex items-center justify-between gap-2 ${i > 0 ? "mt-1.5" : ""}`}>
          <span className="flex items-center gap-1.5 text-[11px] text-panda-grey">
            <Dot kind={l.dotKind} />
            {t(l.labelKey)} · {tr.pct}%
          </span>
          <span className="flex items-center gap-1.5">
            <UnitAwarePriceInput value={l.price} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} label={t(l.labelKey)} onCommit={(v) => draw.setTranchePrice(draftId, tr.id, l.leg, v)} />
            <button
              type="button"
              onClick={() => draw.removeTrancheLeg(draftId, tr.id, l.leg)}
              aria-label={t("draw.clearLeg")}
              title={t("draw.clearLeg")}
              className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-panda-grey transition hover:text-clay-red"
            >
              <span aria-hidden>×</span>
            </button>
          </span>
        </div>
      ))}
      {tv.issues.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-clay-red" role="alert">
          {tv.issues.map((i) => (
            <li key={i}>{t(`draw.issue.${i}` as DictKey)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The summary as one line of translated parts ("Compra a $0,0012 · sin stop"). */
function SummaryLine({ parts, formatValue }: { parts: SummaryPart[]; formatValue: (usd: number) => string }) {
  const { t } = useLanguage();
  const text = parts
    .map((p) => {
      if (p.key === "draw.sum.noStop") return t("draw.sum.noStop");
      if ("pct" in p) return t(p.key, { price: formatValue(p.price), pct: p.pct });
      return t(p.key, { price: formatValue(p.price) });
    })
    .join(" · ");
  return <p className="mt-0.5 text-panda-grey">{text}</p>;
}

/** Shows and edits in whatever unit the chart is currently on (price or market cap) — always converts back
 *  to real USD (`fromDisplay`) the moment a value is committed, since that's the space every draft, the
 *  validation and the server all work in. Applied on Enter or when leaving the box, same as before. */
function UnitAwarePriceInput({ value, unit, toDisplay, fromDisplay, label, onCommit, disabled }: { value?: number; label: string; onCommit: (v: string) => void; disabled?: boolean } & PriceDisplayApi) {
  const { lang } = useLanguage();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null) {
      // Read back exactly what the field shows ("$6,69M", "$0,00012"), so what's typed is never misread.
      const typed = parseDisplayValue(text);
      if (typed !== null) onCommit(String(fromDisplay(typed)));
    }
    setText(null);
  };
  const display = value !== undefined ? toDisplay(value) : undefined;
  const shown = display !== undefined ? formatDisplayValue(display, unit === "mcap" ? "mcap" : "price", lang) : "";
  return (
    <input
      value={text ?? shown}
      onChange={(e) => setText(sanitizeDisplayInput(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      inputMode="decimal"
      placeholder="—"
      disabled={disabled}
      aria-label={unit === "mcap" ? `${label} (market cap)` : `${label} (USD)`}
      className="w-24 bg-transparent text-right text-sm font-semibold outline-none placeholder:text-panda-grey sm:w-28"
    />
  );
}

function PriceSummary({ buy, sells, stop, formatValue }: { buy?: number; sells: { price?: number; pct: number }[]; stop?: number; formatValue: (usd: number) => string }) {
  const { t } = useLanguage();
  const sellText = sells
    .map((s, i) => (s.price ? `${sells.length > 1 ? `#${i + 1} ` : ""}${formatValue(s.price)}` : "—"))
    .join(" / ");
  return (
    <p className="mt-0.5 text-panda-grey">
      <span style={{ color: lineColor("buy") }}>{t("draw.line.buy")}</span> {buy ? formatValue(buy) : "—"} → <span style={{ color: lineColor("sell1") }}>{t("draw.line.sell")}</span> {sellText}
      {stop ? (
        <>
          {" · "}
          <span style={{ color: lineColor("stop") }}>{t("draw.line.stop")}</span> {formatValue(stop)}
        </>
      ) : null}
    </p>
  );
}

function SavedStrategies({ draw, formatValue }: { draw: DrawApi; formatValue: (usd: number) => string }) {
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
          <RecordGroupCard key={g.groupId} group={g} draw={draw} formatValue={formatValue} />
        ))}
      </div>
    </div>
  );
}

/** One card per drawn position, even when it's several real tranches underneath (see useDrawTrade.ts's
 *  `recordGroups`) — the header shows it as ONE operation; each tranche still gets its own status/tx/cancel,
 *  since each really is its own independent order on Jupiter. */
function RecordGroupCard({ group, draw, formatValue }: { group: RecordGroup; draw: DrawApi; formatValue: (usd: number) => string }) {
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
        <PriceSummary buy={first.buyUsd} sells={legs.map((l) => ({ price: l.sellUsd, pct: l.legPct ?? 100 }))} stop={first.stopUsd} formatValue={formatValue} />
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
      {hasHelp && <p className="mt-1 text-panda-grey">{t(helpKey, { price: formatPrice(r.buyUsd ?? 0) })}</p>}
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
