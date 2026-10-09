"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatPct, formatPrice, formatRelativeTime, formatUsd } from "@/lib/format";
import { needsNoStopNotice } from "@/lib/strategy/summary";
import { PCT_ROW } from "@/lib/strategy/allocation";
import { firstProblem, orderCount } from "@/lib/strategy/problem";
import type { Draft } from "./useDrawTrade";
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
import { heldLineColor, lineColor } from "./ChartOverlay";
import { usePriceImpact } from "@/components/coin/usePriceImpact";
import { useFeeBps } from "@/lib/pump/useFeeBps";
import { useWallet } from "@solana/wallet-adapter-react";
import { LIVE, NONCE_DEPOSIT_LAMPORTS_ESTIMATE, type ClientOrder, type OrderGroup } from "@/lib/panda-orders/client-types";
import { rememberUnit, type BuyUnit, type DrawApi, type DraftView } from "./useDrawTrade";

const PAY_WITH: FundingAsset[] = ["SOL", "USDC"];
const STEP_KEYS: Record<string, DictKey> = {
  session: "draw.step.session",
  jupiter: "draw.step.jupiter",
  prepare: "draw.step.prepare",
  setup: "draw.step.setup",
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

/** Server error codes of /api/panda-orders/* that have their own sentence (orders.err.<code>). */
const PANDA_ERR = ["wallet_modified", "invalid_signature", "unsupported_coin", "risk_not_accepted", "no_balance", "too_large", "nonce_pending", "not_configured", "expired", "issues", "price_unavailable", "too_many", "over_100", "FEATURE_DISABLED", "PAUSED"];

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
  // Venta/Stop either complete a drawn buy (the full buy→sell→stop strategy) or, with no buy, act on the coin
  // the wallet already holds — so they're usable whenever there's a buy line OR a real balance of this coin.
  const current = draw.current;
  const heldLines = !!current && current.buy === undefined && (current.tranches?.length ?? 0) > 0;
  const canSell = !!current?.buy || draw.heldStatus === "has";
  const sellHint: DictKey = !draw.connected ? "draw.sellNeedsConnect" : draw.heldStatus === "unknown" ? "draw.balanceLoading" : "draw.sellNeedsCoin";
  const busy = draw.step !== "idle" && draw.step !== "done";

  // On a phone this section starts folded, so the chart and the buy box sit close together; it opens with a tap (and stays open while a line is being drawn).
  const isDesktop = useIsDesktop();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = !!target || (userOpen ?? isDesktop);
  const view = current ? draw.views.find((v) => v.draft.id === current.id) ?? null : null;
  const count = (view ? 1 : 0) + draw.recordGroups.length + draw.pandaGroups.length;
  // The row of % buttons belongs to sells / stops on a coin already held — not to a drawn buy.
  const showPct = !current?.buy && (draw.heldStatus === "has" || heldLines);

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
      <div className="mt-3 sm:mt-0">
        <h2 id="draw-title" className="hidden font-display text-base font-bold sm:block">
          {t("draw.title")}
        </h2>
        <p className="mt-0.5 text-xs text-panda-grey">{t("draw.subtitle")}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <TargetTabs target={target} canSell={canSell} canBuy={draw.strategiesOn && !heldLines} busy={busy} onPick={draw.startTarget} disabledTitle={t(sellHint)} buyOffTitle={t(heldLines ? "draw.buyClearLines" : "draw.buyOff")} />
        {target && (
          <button type="button" onClick={draw.cancelDrawing} className="text-xs font-semibold text-panda-grey underline underline-offset-2 hover:text-paper">
            {t("draw.cancelMode")}
          </button>
        )}
      </div>

      {showPct && <PctBar draw={draw} busy={busy} />}
      {showPct && draw.pickPctHint && draw.selectedPct === null && (
        <p className="mt-2 text-xs font-semibold text-clay-red" role="alert">
          {t("draw.pickPct")}
        </p>
      )}

      {target ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-paper/80" role="status">
          <Dot kind={target} />
          {t(MODE_KEYS[target])}
        </p>
      ) : canSell ? (
        !current?.buy && !heldLines && <p className="mt-2 text-xs text-panda-grey">{t("draw.heldHint", { ticker: coin.ticker })}</p>
      ) : (
        !heldLines && (
          // A `title` tooltip never shows on a touch tap, so without this a phone gives zero explanation
          // for why "Venta"/"Stop" look disabled — this is always visible instead, on every device.
          <p className="mt-2 text-xs text-panda-grey">
            {t(sellHint)}
            {draw.connected && draw.heldStatus === "none" && <span className="block text-panda-grey/80">{t("draw.sellNeedsCoinBuy")}</span>}
          </p>
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

      {/* One drawing at a time: its lines, one message, one button. */}
      {view && (view.draft.buy !== undefined || heldLines) && (
        <div className="mt-3">
          <DraftBlock view={view} draw={draw} coin={coin} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} />
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
      {draw.pandaMode && (draw.pandaGroups.length > 0 || draw.freeNonces.length > 0) && <PandaOrders draw={draw} formatValue={formatValue} />}

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
function TargetTabs({ target, canSell, canBuy, busy, onPick, disabledTitle, buyOffTitle }: { target: DrawTarget | null; canSell: boolean; canBuy: boolean; busy: boolean; onPick: (t: DrawTarget) => void; disabledTitle: string; buyOffTitle: string }) {
  const { t } = useLanguage();
  const tabs: { key: DrawTarget; labelKey: DictKey }[] = [
    { key: "buy", labelKey: "draw.line.buy" },
    { key: "sell1", labelKey: "draw.line.sell" },
    { key: "stop", labelKey: "draw.line.stop" },
  ];
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-ink p-0.5" role="group" aria-label={t("draw.title")}>
      {tabs.map(({ key, labelKey }) => {
        const disabled = busy || (key !== "buy" && !canSell) || (key === "buy" && !canBuy);
        const active = target === key || (key === "sell1" && !!target?.startsWith("sell"));
        const color = lineColor(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            disabled={disabled}
            title={disabled && !busy ? (key === "buy" ? buyOffTitle : disabledTitle) : undefined}
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
      ) : error.code && PANDA_ERR.includes(error.code) ? (
        <>
          {t(`orders.err.${error.code}` as DictKey)}
          {error.pandaIssues && (
            <ul className="mt-1 space-y-0.5">
              {[...new Set(Object.values(error.pandaIssues).flat())].map((i) => (
                <li key={i}>{t(`orders.issue.${i}` as DictKey)}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {t("draw.err.generic")}
          {error.message && <span className="mt-1 block break-words text-clay-red/80">{error.message.length > 220 ? `${error.message.slice(0, 220)}…` : error.message}</span>}
        </>
      )}
    </div>
  );
}

function DraftBlock({ view, draw, coin, unit, toDisplay, fromDisplay }: { view: DraftView; draw: DrawApi; coin: Coin } & PriceDisplayApi) {
  const { t, lang } = useLanguage();
  const { draft } = view;
  const [ack, setAck] = useState(false);
  const [impactAck, setImpactAck] = useState(false);
  const { publicKey } = useWallet();
  const feeBps = useFeeBps(publicKey?.toBase58() ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const confirming = draw.step !== "idle" && draw.step !== "done";
  // A held-coin draft (no buy leg) is governed entirely by its percentage tranches now — see TrancheEditor
  // below; a buy-including draft is complete once its legs make one of the two offered shapes (kinds.ts).
  const heldMode = draft.buy === undefined;
  const complete = heldMode ? view.tranches.length > 0 : view.kind !== null;
  const panda = heldMode && draw.pandaMode;
  const hasStop = (draft.tranches ?? []).some((t) => t.stop !== undefined);

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
  const notice: { text: string; tone: string } = panda
    ? { text: t(draw.connected ? "draw.pandaNotice" : "draw.connect"), tone: "text-panda-grey" }
    : short !== undefined
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

  // ONE short message next to the button: the first thing to fix (problem.ts), else the usual one-line notice.
  // Nothing is ever listed under each line. While the wallet isn't connected (or its balance is still loading)
  // "you don't hold it" would be wrong, so it isn't said.
  const balanceKnown = draw.connected && draw.heldStatus !== "unknown";
  const issues = (heldMode ? view.tranches.flatMap((tv) => tv.issues) : draft.amount !== "" ? view.issues : []).filter((i) => balanceKnown || i !== "no_balance");
  const problem = draw.connected ? firstProblem(issues, heldMode ? view.allocatedPct : 0) : null;
  const message = problem ? { text: t(`draw.issue.${problem}` as DictKey), tone: "text-clay-red font-semibold" } : notice;
  const orders = heldMode ? orderCount(draft.tranches ?? []) : 1;

  return (
    <div>

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
      {heldMode && <HeldLines draft={draft} draw={draw} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} />}
      {!heldMode && needsNoStopNotice({ buy: draft.buy, sell: draft.sell, stop: draft.stop }) && <p className="mt-2 text-[11px] text-panda-grey">{t("draw.noStopWarning")}</p>}

      {complete && (
        <>
          {!heldMode && (
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

          {panda && (
            <p className="mt-3 text-[11px] text-panda-grey">
              {t("draw.pandaFee", { fee: (feeBps / 100).toLocaleString(lang, { maximumFractionDigits: 2 }), deposit: (NONCE_DEPOSIT_LAMPORTS_ESTIMATE / 1e9).toLocaleString(lang, { maximumFractionDigits: 4 }) })}
            </p>
          )}
          {(funding || heldMode) && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-paper/80">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--meme-orange)]" />
              {/* One short box: for a PANDA order with a stop it IS the stop's risk acceptance; Jupiter's vault text only for Jupiter. */}
              <span>{t(panda ? (hasStop ? "draw.pandaAckStop" : "draw.pandaAckShort") : "draw.custodyShort")}</span>
            </label>
          )}

          {/* Fixed, always visible right above the confirm button — one discrete line, never a stack of boxes. */}
          <p className={`mt-3 text-xs ${message.tone}`} role={message.tone.includes("clay-red") ? "alert" : undefined}>
            {message.text}
          </p>
          {impactHigh && (
            <label className="mt-1.5 flex cursor-pointer items-start gap-2 text-[11px] text-clay-red">
              <input type="checkbox" checked={impactAck} onChange={(e) => setImpactAck(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--clay-red)]" />
              <span>{t("trading.priceImpactAck")}</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => (panda ? draw.confirmPanda(view, hasStop && ack) : heldMode ? draw.confirmTranches(view) : draw.confirm(view))}
            disabled={!view.ready || !!problem || !draw.connected || !ack || confirming || (!panda && (!draw.engine || (!heldMode && impactHigh && !impactAck)))}
            className="mt-3 w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirming || draw.step === "done" ? `${t(STEP_KEYS[draw.step])}${draw.batchProgress ? ` (${draw.batchProgress.done}/${draw.batchProgress.total})` : ""}` : t(orders === 1 ? "draw.sign1" : "draw.signN", { n: orders })}
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

/** The one row of % buttons: the marked one STAYS marked (green) and every new sell / stop line takes it. "Otro"
 *  opens a small 1–100 box; a custom value then shows on that button, marked. */
function PctBar({ draw, busy }: { draw: DrawApi; busy: boolean }) {
  const { t } = useLanguage();
  const [otherOpen, setOtherOpen] = useState(false);
  const [value, setValue] = useState("");
  const sel = draw.selectedPct;
  const custom = sel !== null && !(PCT_ROW as readonly number[]).includes(sel);
  const btn = (on: boolean) =>
    `min-h-9 min-w-0 flex-1 whitespace-nowrap rounded-lg px-0 text-[11px] font-semibold tracking-tight tabular-nums transition-colors disabled:opacity-40 sm:px-1 sm:text-xs ${
      on ? "bg-bamboo text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]" : "bg-paper/5 text-paper/80 hover:bg-paper/10"
    }`;
  const apply = () => {
    const n = Math.round(Number(value.replace(",", ".")) * 10) / 10;
    if (n >= 1 && n <= 100) {
      draw.setSelectedPct(n);
      setOtherOpen(false);
      setValue("");
    }
  };
  return (
    <div className="mt-3">
      <div className="flex gap-1" role="group" aria-label={t("draw.pctLabel")}>
        {PCT_ROW.map((p) => (
          <button key={p} type="button" disabled={busy} aria-pressed={sel === p} onClick={() => (draw.setSelectedPct(p), setOtherOpen(false))} className={btn(sel === p)}>
            {p}%
          </button>
        ))}
        <button type="button" disabled={busy} aria-pressed={custom} aria-expanded={otherOpen} onClick={() => setOtherOpen((v) => !v)} className={btn(custom)}>
          {custom ? `${sel}%` : t("draw.other")}
        </button>
      </div>
      {otherOpen && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="1-100"
            inputMode="decimal"
            aria-label={t("draw.other")}
            className="w-20 rounded-lg bg-ink px-2.5 py-2 text-right text-xs outline-none placeholder:text-panda-grey"
          />
          <span className="text-xs text-panda-grey">%</span>
          <button type="button" onClick={apply} className="rounded-lg bg-paper px-3 py-2 text-xs font-semibold text-ink">
            {t("draw.apply")}
          </button>
        </div>
      )}
    </div>
  );
}

/** The lines drawn on a held coin, one small card each, in its line's color (green sell, red stop): the type with
 *  its arrow and the % in a big pill on the left; the price (tap to edit) and how far it is from now on the right; a
 *  big × to remove it. */
function HeldLines({ draft, draw, unit, toDisplay, fromDisplay }: { draft: Draft; draw: DrawApi } & PriceDisplayApi) {
  const { t, lang } = useLanguage();
  const rows = (draft.tranches ?? []).flatMap((tr) =>
    (["sell", "stop"] as const).filter((leg) => tr[leg] !== undefined).map((leg) => ({ tr, leg, price: tr[leg]! }))
  );
  const now = draw.currentUsd;
  const pctFmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, signDisplay: "exceptZero" });
  return (
    <div className="space-y-2">
      {rows.map(({ tr, leg, price }) => {
        const color = heldLineColor(leg === "sell" ? "sell1" : "stop", true);
        const label = t(leg === "sell" ? "draw.line.sell" : "draw.line.stop");
        const dist = now && now > 0 ? (price / now - 1) * 100 : null;
        return (
          <div key={`${tr.id}-${leg}`} className="flex items-stretch overflow-hidden rounded-xl border border-paper/10 bg-ink-raised">
            <span className="w-1 shrink-0" style={{ background: color }} aria-hidden />
            <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 pr-1 sm:gap-3 sm:pl-3">
              <span className="flex shrink-0 items-center gap-1 text-xs font-semibold" style={{ color }}>
                <span aria-hidden className="text-sm leading-none">{leg === "sell" ? "↑" : "↓"}</span>
                {label}
              </span>
              <span className="shrink-0 rounded-lg px-2 py-1 text-base font-bold leading-none tabular-nums" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
                {tr.pct}%
              </span>
              <span className="ml-auto flex min-w-0 flex-col items-end">
                <UnitAwarePriceInput value={price} unit={unit} toDisplay={toDisplay} fromDisplay={fromDisplay} label={label} onCommit={(v) => draw.setTranchePrice(draft.id, tr.id, leg, v)} />
                {dist !== null && (
                  <span className={`text-[11px] font-medium tabular-nums ${dist >= 0 ? "text-bamboo" : "text-clay-red"}`} title={t("draw.vsNow")}>
                    {pctFmt.format(Math.round(dist * 10) / 10)}%
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => draw.removeTrancheLeg(draft.id, tr.id, leg)}
                aria-label={`${t("draw.clearLeg")} · ${label} ${tr.pct}%`}
                title={t("draw.clearLeg")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-panda-grey transition hover:bg-paper/5 hover:text-clay-red"
              >
                <span aria-hidden>×</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
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

const ORDER_TONE: Record<ClientOrder["state"], string> = {
  prepared: "bg-paper/10 text-paper/80",
  active: "bg-paper/10 text-paper/80",
  sending: "bg-meme-orange/20 text-meme-orange",
  executed: "bg-bamboo/20 text-bamboo",
  cancelled: "bg-paper/10 text-panda-grey",
  needs_resign: "bg-clay-red/20 text-clay-red",
};

/** PANDA orders on this coin: one card per drawn strategy, a row per tranche (its sell and/or stop), with Cancel for what
 *  is still waiting, "Volver a firmar" for what stopped being valid, and the free deposits to take back. */
function PandaOrders({ draw, formatValue }: { draw: DrawApi; formatValue: (usd: number) => string }) {
  const { t, lang } = useLanguage();
  const groups = draw.pandaGroups.slice(0, 8);
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-paper/80">{t("orders.title")}</p>
        {draw.freeNonces.length > 0 && (
          <button type="button" onClick={() => draw.closePanda({ recover: true })} disabled={draw.cancelling !== null} className="text-xs font-semibold text-meme-orange hover:brightness-110 disabled:opacity-50">
            {draw.cancelling === "recover" ? t("orders.recovering") : t("orders.recover", { sol: (draw.freeDepositLamports / 1e9).toLocaleString(lang, { maximumFractionDigits: 5 }) })}
          </button>
        )}
      </div>
      <div className="mt-2 space-y-2.5">
        {groups.map((g) => (
          <PandaGroupCard key={g.groupId} group={g} draw={draw} formatValue={formatValue} />
        ))}
      </div>
    </div>
  );
}

function PandaGroupCard({ group, draw, formatValue }: { group: OrderGroup; draw: DrawApi; formatValue: (usd: number) => string }) {
  const { t } = useLanguage();
  const legs = group.tranches.flatMap((x) => x.legs);
  const anyLive = legs.some((l) => LIVE.has(l.state));
  const needsResign = legs.some((l) => l.state === "needs_resign");
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink px-3.5 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap gap-3">
          {needsResign && (
            <button type="button" onClick={() => draw.resignPanda(group.groupId)} className="font-semibold text-meme-orange hover:brightness-110">
              {t("orders.resign")}
            </button>
          )}
          {anyLive && (
            <button type="button" onClick={() => draw.closePanda({ groupId: group.groupId })} disabled={draw.cancelling !== null} className="font-semibold text-clay-red hover:brightness-110 disabled:opacity-50">
              {draw.cancelling === group.groupId ? t("draw.cancelling") : t("orders.cancelAll")}
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {group.tranches.map((tr) => (
          <div key={`${tr.trancheId}-${tr.legs[0]?.id}`} className="border-t border-paper/10 pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-panda-grey">{tr.pct}%</span>
              {tr.legs.some((l) => LIVE.has(l.state)) && group.tranches.length > 1 && (
                <button type="button" onClick={() => draw.closePanda({ groupId: group.groupId, trancheId: tr.trancheId })} disabled={draw.cancelling !== null} className="font-semibold text-clay-red hover:brightness-110 disabled:opacity-50">
                  {draw.cancelling === tr.trancheId ? t("draw.cancelling") : t("orders.cancel")}
                </button>
              )}
            </div>
            {tr.legs.map((l) => (
              <div key={l.id} className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-paper/90">
                  <Dot kind={l.leg === "sell" ? "sell1" : "stop"} />
                  {t(l.leg === "sell" ? "draw.line.sell" : "draw.line.stop")} · {formatValue(l.targetUsd)}
                </span>
                <span className="flex items-center gap-2">
                  {l.state === "executed" && l.signature && (
                    <a href={`https://solscan.io/tx/${l.signature}`} target="_blank" rel="noreferrer" className="text-bamboo hover:underline">
                      {t("orders.tx")}
                    </a>
                  )}
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${ORDER_TONE[l.state]}`}>{t(`orders.state.${l.state}` as DictKey)}</span>
                </span>
              </div>
            ))}
            {tr.legs.some((l) => l.state === "needs_resign" && l.reason) && (
              <p className="mt-1 text-clay-red">{t(`orders.reason.${tr.legs.find((l) => l.state === "needs_resign")!.reason}` as DictKey)}</p>
            )}
            {tr.legs.some((l) => l.notice === "stop_slippage" && l.state === "active") && <p className="mt-1 text-sun">{t("orders.slippageNote")}</p>}
            {tr.legs.some((l) => l.notice === "no_sol" && l.state === "active") && <p className="mt-1 text-sun">{t("orders.noSolNote")}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
