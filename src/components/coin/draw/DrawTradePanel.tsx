"use client";

import { sanitizeDecimalInput } from "@/lib/trading/input";
import { useState, useSyncExternalStore } from "react";
import { formatPct, formatPrice, formatRelativeTime, formatUsd } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { convertAmount, type FundingAsset, type StrategyIssue } from "@/lib/strategy/plan";
import type { DrawTarget } from "@/lib/strategy/draw-machine";
import type { StrategyRecord, StrategyStatus } from "@/lib/strategy/types";
import { LINE_COLOR } from "./ChartOverlay";
import { rememberUnit, type BuyUnit, type DrawApi, type DraftView } from "./useDrawTrade";

const PAY_WITH: FundingAsset[] = ["SOL", "USDC"];
const STEP_KEYS: Record<string, DictKey> = {
  session: "draw.step.session",
  jupiter: "draw.step.jupiter",
  prepare: "draw.step.prepare",
  sign: "draw.step.sign",
  create: "draw.step.create",
  done: "draw.step.done",
};
const MODE_KEYS: Record<DrawTarget, DictKey> = { buy: "draw.mode.buy", sell: "draw.mode.sell", stop: "draw.mode.stop" };
const SET_KEYS: Record<DrawTarget, DictKey> = { buy: "draw.set.buy", sell: "draw.set.sell", stop: "draw.set.stop" };
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

export default function DrawTradePanel({ draw }: { draw: DrawApi }) {
  const { t } = useLanguage();
  const target = draw.machine.target;
  const canSell = !!draw.active?.buy;
  const canStop = !!draw.active?.buy;
  const busy = draw.step !== "idle" && draw.step !== "done";

  // On a phone this section starts folded, so the chart and the buy box sit close together; it opens with a tap (and stays open while a line is being drawn).
  const isDesktop = useIsDesktop();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = !!target || (userOpen ?? isDesktop);
  const count = draw.views.length + draw.records.length;

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
          <TargetButton kind="sell" active={target === "sell"} disabled={busy || !canSell} onClick={() => draw.startTarget("sell")} title={!canSell ? t("draw.sellNeedsBuy") : undefined}>
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
            <DraftCard key={v.draft.id} view={v} draw={draw} expanded={v.draft.id === draw.activeId} />
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

      {draw.records.length > 0 && <SavedStrategies draw={draw} />}

      {draw.error && <ErrorNote error={draw.error} />}
      </>
      )}
    </section>
  );
}

function Dot({ kind }: { kind: DrawTarget }) {
  return <span className="mt-[3px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: LINE_COLOR[kind] }} aria-hidden />;
}

/** Each mode gets its own little bamboo stalk (same colors as its chart line) instead of a plain dot —
 * a small nod to PANDA's bamboo theme on the button that matters most for "drawing your trade". When
 * active, the button itself takes on that color instead of turning plain white. */
function TargetButton({ kind, active, disabled, onClick, title, children }: { kind: DrawTarget; active: boolean; disabled?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  const color = LINE_COLOR[kind];
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
      ) : (
        <>
          {t("draw.err.generic")}
          {error.message && <span className="mt-1 block break-words text-clay-red/80">{error.message.length > 220 ? `${error.message.slice(0, 220)}…` : error.message}</span>}
        </>
      )}
    </div>
  );
}

function DraftCard({ view, draw, expanded }: { view: DraftView; draw: DrawApi; expanded: boolean }) {
  const { t, lang } = useLanguage();
  const { draft } = view;
  const [ack, setAck] = useState(false);
  const confirming = draw.step !== "idle" && draw.step !== "done";
  const complete = draft.buy !== undefined && draft.sell !== undefined;

  if (!expanded) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-paper/10 bg-ink px-3.5 py-3 text-xs">
        <div className="min-w-0">
          <p className="font-semibold">
            {t("draw.strategy", { n: draft.n })} <span className="ml-1 rounded-full bg-paper/10 px-2 py-0.5 text-[10px] font-medium text-panda-grey">{t("draw.draft")}</span>
          </p>
          <PriceSummary buy={draft.buy} sell={draft.sell} stop={draft.stop} />
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

  const f = view.funding;
  const funding = f && f.ok ? f.funding : null;
  const rateMissing = f && !f.ok && f.reason === "price_unavailable";
  const short = f && !f.ok && f.reason === "insufficient" ? f.shortfallUsd : undefined;
  const m = view.metrics;
  const q = draw.quote;
  const rates = { solUsd: q?.solUsd ?? null, usdcUsd: q?.usdcUsd ?? null, eurUsd: q?.eurUsd ?? null };

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

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["buy", "sell", "stop"] as const).map((kind) => (
          <div key={kind} className="rounded-xl bg-ink-raised px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11px] text-panda-grey">
              <Dot kind={kind} />
              {t(`draw.label.${kind}` as DictKey)}
            </span>
            <PriceInput value={draft[kind]} label={t(`draw.label.${kind}` as DictKey)} onCommit={(v) => draw.setPrice(draft.id, kind, v)} />
          </div>
        ))}
      </div>
      {draft.stop === undefined && <p className="mt-2 text-[11px] text-panda-grey">{t("draw.stopHint")}</p>}

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

          {m && view.amountUsd && (
            <>
              <dl className="mt-3 space-y-1.5 rounded-xl bg-ink-raised px-3.5 py-3 text-xs">
                <Row label={t("draw.fee")} value={`+ ${money(m.feeUsd)}`} muted />
                <Row label={t("draw.total")} value={money(view.amountUsd + m.feeUsd)} strong />
                <div className="border-t border-paper/10 pt-1.5" />
                <Row label={t("draw.ifSell")} value={`${signedMoney(m.netProfitUsd)} (${formatPct((m.netProfitUsd / view.amountUsd) * 100)})`} tone={m.netProfitUsd >= 0 ? "text-bamboo" : "text-clay-red"} strong />
                <Row label={t("draw.stopResult")} value={`${signedMoney(m.netStopLossUsd)} (${formatPct((m.netStopLossUsd / view.amountUsd) * 100)})`} tone="text-clay-red" />
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

          <button
            type="button"
            onClick={() => draw.confirm(view)}
            disabled={!view.ready || !draw.engine || !draw.connected || !ack || confirming}
            className="mt-3 w-full rounded-xl bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirming || draw.step === "done" ? t(STEP_KEYS[draw.step]) : t("draw.confirm")}
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

function PriceSummary({ buy, sell, stop }: { buy?: number; sell?: number; stop?: number }) {
  const { t } = useLanguage();
  return (
    <p className="mt-0.5 text-panda-grey">
      <span style={{ color: LINE_COLOR.buy }}>{t("draw.line.buy")}</span> {buy ? formatPrice(buy) : "—"} → <span style={{ color: LINE_COLOR.sell }}>{t("draw.line.sell")}</span> {sell ? formatPrice(sell) : "—"}
      {stop ? (
        <>
          {" · "}
          <span style={{ color: LINE_COLOR.stop }}>{t("draw.line.stop")}</span> {formatPrice(stop)}
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
        {draw.records.map((r) => (
          <RecordCard key={r.id} r={r} draw={draw} />
        ))}
      </div>
    </div>
  );
}

function RecordCard({ r, draw }: { r: StrategyRecord; draw: DrawApi }) {
  const { t } = useLanguage();
  const status = r.state as StrategyStatus;
  const live = !["completed", "failed", "cancelled"].includes(r.state);
  const helpKey = `draw.help.${status}` as DictKey;
  const hasHelp = ["waiting", "buy_triggered", "position_open", "sell_triggered", "cancelled"].includes(status);
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink px-3.5 py-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{t("draw.strategy", { n: r.n })}</p>
          <PriceSummary buy={r.buyUsd} sell={r.sellUsd} stop={r.stopUsd} />
          <p className="mt-0.5 text-panda-grey">
            {money(r.amountUsd)} · {r.fundingAsset} → ${r.ticker}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[status]}`}>{t(`draw.status.${status}` as DictKey)}</span>
      </div>

      {hasHelp && <p className="mt-2 text-panda-grey">{t(helpKey, { price: formatPrice(r.buyUsd) })}</p>}
      {status === "completed" && <p className="mt-2 text-panda-grey">{r.sellKind === "stop_loss" ? t("draw.closedStop") : t("draw.closedTarget")}</p>}
      {status === "failed" && r.error && <p className="mt-2 break-words text-clay-red">{r.error}</p>}
      {r.holdsTokens && <p className="mt-2 text-meme-orange">{t("draw.holds")}</p>}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
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
          <div className="flex items-center gap-3">
            <span className="cursor-not-allowed text-panda-grey/60" title={t("draw.editLive")}>
              {t("draw.edit")}
            </span>
            <button type="button" onClick={() => draw.cancelLive(r)} disabled={draw.cancelling === r.id} className="font-semibold text-clay-red hover:brightness-110 disabled:opacity-50">
              {draw.cancelling === r.id ? t("draw.cancelling") : t("draw.cancelStrategy")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
