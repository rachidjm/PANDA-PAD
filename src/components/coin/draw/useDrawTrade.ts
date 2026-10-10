"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Coin } from "@/lib/types";
import type { TriggerOrder } from "@/lib/jupiter/trigger";
import { useReadConnection } from "@/lib/solana/useReadConnection";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { base64ToTransaction, base64ToVersionedTransaction, transactionToBase64, versionedTransactionToBase64 } from "@/lib/pump/wire";
import {
  amountToUsd,
  type AmountUnit,
  chooseFunding,
  preferredFunding,
  roundPrice,
  strategyMetrics,
  STRATEGY_FEE_BPS,
  USDC_MINT,
  validateStrategy,
  type FundingAsset,
  type FundingResult,
  type Rates,
  type StrategyIssue,
  type StrategyMetrics,
} from "@/lib/strategy/plan";
import { abort, down, IDLE, move, start, up, type DrawState, type DrawTarget } from "@/lib/strategy/draw-machine";
import { kindOf, validateKind, type KindIssue, type OrderKind } from "@/lib/strategy/kinds";
import {
  allocatedPct as sumAllocatedPct,
  fitsLeg,
  heldStatus as heldStatusOf,
  linesOf,
  pickHeldDraft,
  placeLine,
  removeLine as removeLineFrom,
  updateLinePrice,
  remainingPct as sumRemainingPct,
  removeTranche as removeTrancheFrom,
  setTranchePct as setTranchePctOf,
  trancheKind,
  validateTranches,
  type Tranche,
} from "@/lib/strategy/allocation";
import { TERMINAL, type StrategyRecord } from "@/lib/strategy/types";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { groupOrders, LIVE, type OrdersList } from "@/lib/panda-orders/client-types";
import { accessFromStatus, pandaAccessFor, type PandaAccess } from "@/lib/panda-orders/access-state";

/**
 * The "Draw Your Trade" controller: drafts being drawn (kept in this browser only — they are not orders),
 * the saved strategies the server knows about, the drawing gesture, and the confirm flow. Placing a real
 * order is the last step and needs an explicit "Confirm Strategy" plus the wallet's own signature.
 */

export type Draft = {
  id: string;
  n: number;
  buy?: number;
  sell?: number;
  stop?: number;
  amount: string;
  /** Percentage tranches of a held token's position (allocation.ts) — only meaningful while `buy` is unset:
   *  the full buy→sell→stop strategy always exits 100% and never uses this. Each tranche is validated and
   *  signed as PANDA orders (see confirmPanda) — never Jupiter ones. */
  tranches?: Tranche[];
  /** What the amount is typed in. */
  unit: BuyUnit;
  /** The coin that pays when the amount is in dollars or euros. null = the one the wallet holds most of. */
  pay: FundingAsset | null;
};

export type BuyUnit = Extract<AmountUnit, "SOL" | "USD" | "EUR">;

/** `sellTargetAt(0)` ("sell1") is the only sell target a NEW draft ever uses — the function still takes an
 *  index because it also addresses each leg of an OLD, legacy multi-tranche strategy (up to 10 of them), by
 *  its `legIndex`, when drawing/coloring that strategy's saved lines on the chart (see `lines` below). */
export function sellTargetAt(index: number): DrawTarget {
  return `sell${Math.max(1, index + 1)}` as DrawTarget;
}

export type ChartLine = {
  key: string;
  groupId: string;
  kind: DrawTarget;
  price: number;
  tag: string;
  live: boolean;
  active: boolean;
  /** Set only on a sell/stop tranche's own line: the % of the position it sells. */
  pct?: number;
  /** Set only on a DRAFT held-coin line (never a live/saved one): grabbing its tag on the chart moves this whole line. */
  lineId?: string;
  /** A sell / stop on a coin already held (a draft tranche or a live PANDA order): its sell is drawn green. */
  held?: boolean;
  /** A live PANDA order that can be changed: grabbing its tag moves it, and the change waits for "Guardar cambio". */
  order?: { groupId: string; trancheId: string; leg: "sell" | "stop" };
  /** That order's line has been moved (or its % changed) and the change isn't signed yet. */
  edited?: boolean;
};

/** A change to a live PANDA order's tranche that the user hasn't signed yet: only what differs from the live order. */
export type OrderEdit = { groupId: string; trancheId: string; sellUsd?: number; stopUsd?: number; pct?: number };
export const orderEditKey = (groupId: string, trancheId: string) => `${groupId}:${trancheId}`;

export type Quote = Rates & { tokenUsd: number | null; liquidityUsd: number | null; priceChangeH1Pct: number | null; engine: boolean };

export type Step = "idle" | "session" | "jupiter" | "prepare" | "setup" | "sign" | "signOrders" | "create" | "cancel" | "done" | "doneOrders";


/** One percentage tranche's own order shape, issues and readiness (allocation.ts's rules). */
export type TrancheView = { tranche: Tranche; kind: OrderKind | null; issues: KindIssue[]; ready: boolean };

export type DraftView = {
  draft: Draft;
  /** The coin that will pay: the user's pick, else the one the wallet holds most of. Only meaningful for a buy. */
  asset: FundingAsset;
  amountUsd: number | null;
  funding: FundingResult | null;
  issues: KindIssue[];
  /** Null until buy/sell/stop and a priced amount are all in. */
  metrics: StrategyMetrics | null;
  ready: boolean;
  /** Which order shape the legs make (kinds.ts) for a BUY-including draft; always null for a held-token draft
   *  (its tranches can each be a different shape — see `tranches` below). */
  kind: OrderKind | null;
  /** This draft's percentage tranches (empty for a buy-including draft). */
  tranches: TrancheView[];
  /** % of the held balance already assigned across `tranches`, and what's left (0–100, sums to 100). */
  allocatedPct: number;
  remainingPct: number;
  /** The wallet's balance of this coin, read fresh — null until known. */
  tokenBalance: number | null;
};

export type Notice = { kind: DrawTarget; price: number } | null;

/** A saved (submitted) strategy's tranches, grouped back into one card — see `groupId` on StrategyRecord. `legs` is sorted by `legIndex`. */
export type RecordGroup = { groupId: string; n: number; legs: StrategyRecord[] };

const storageKey = (mint: string) => `panda.draw.v1.${mint}`;
const JWT_TTL_MS = 23 * 60 * 60 * 1000;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useDrawTrade(coin: Coin | null, chartPrice: number) {
  const readConnection = useReadConnection();
  const { connected, publicKey, signMessage, signTransaction, signAllTransactions, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { ensureSession } = useWalletSession();
  const features = useFeatures();
  const mint = coin?.mint ?? "";
  // PANDA orders: a held coin's sells / stops are pre-signed and kept by PANDA (no $10 minimum, any %). A sell / stop
  // with no buy is ALWAYS one of these — never a Jupiter order, not even as a fallback (access-state.ts). When they
  // aren't available (no session, not on the rollout list, not a Pump.fun coin, server down) nothing is sent and the
  // panel says why; Jupiter is only for a drawn buy.
  const pandaEligible = !!coin && features.pandaOrders && (coin.source === "pump-fun" || coin.source === "pumpswap");
  // Only the server knows who's on the rollout list and whether the PANDA session is still valid: it answers on
  // /api/panda-orders/list (401 = sign in, or sign in AGAIN once it had worked on this page — e.g. after a logout elsewhere or 7 days unused).
  const [serverAccess, setServerAccess] = useState<PandaAccess>("checking");
  const hadAccess = useRef(false);
  const pandaAccess = pandaAccessFor({ featureOn: features.pandaOrders, source: coin?.source, server: serverAccess });
  const pandaMode = pandaAccess === "ok";

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [records, setRecords] = useState<StrategyRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [machine, setMachineState] = useState<DrawState>(IDLE);
  const machineRef = useRef<DrawState>(IDLE);
  // What the NEXT committed price on the chart is for, while it isn't just "set this leg of the active draft"
  // (the normal path): placing a brand new percentage tranche, or dragging an existing one's line. Cleared the
  // moment it's used, or when drawing is cancelled outright — see startTarget/startTrancheDrag below.
  const pendingTrancheRef = useRef<
    { mode: "place"; leg: "sell" | "stop" } | { mode: "drag"; lineId: string; leg: "sell" | "stop" } | { mode: "order"; groupId: string; trancheId: string; leg: "sell" | "stop" } | null
  >(null);
  // The tab the user picked STAYS picked: every tap on the chart adds (or, for a buy strategy, moves) a line of
  // that type until another tab is picked or drawing is cancelled. `held`: Venta/Stop on a coin already held.
  const modeRef = useRef<{ target: DrawTarget; held: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // The % marked in the one row of buttons: every new sell / stop line takes it (until another one is marked).
  // Nothing is marked when the panel opens — the user picks one first ("Elige primero un %" until they do).
  const [selectedPct, setSelectedPctState] = useState<number | null>(null);
  const [pickPctHint, setPickPctHint] = useState(false);
  // Read when the chart is tapped (the gesture callback doesn't re-subscribe on every change).
  const selectedPctRef = useRef<number | null>(null);
  useEffect(() => {
    selectedPctRef.current = selectedPct;
  }, [selectedPct]);
  const setSelectedPct = useCallback((p: number) => {
    setSelectedPctState(p);
    setPickPctHint(false);
  }, []);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [balances, setBalances] = useState<{ sol: number | null; usdc: number | null }>({ sol: null, usdc: null });
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<{ message?: string; issues?: StrategyIssue[]; code?: string; pandaIssues?: Record<string, string[]>; detail?: { needLamports: number; haveLamports: number } } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const jwt = useRef<{ token: string; at: number } | null>(null);
  const loaded = useRef(false);

  const setMachine = useCallback((s: DrawState) => {
    machineRef.current = s;
    setMachineState(s);
  }, []);

  // ── drafts: remembered in this browser only (a convenience, never an order) ─────────────────────
  useEffect(() => {
    if (!mint) return;
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(storageKey(mint));
        const parsed = raw ? (JSON.parse(raw) as Draft[]) : [];
        // A draft with no BUY, sell, stop or tranche yet is just an empty box left behind: not worth keeping between visits.
        if (Array.isArray(parsed)) {
          setDrafts(
            parsed
              .filter((d) => d && typeof d.id === "string" && (d.buy !== undefined || d.sell !== undefined || d.stop !== undefined || (Array.isArray((d as unknown as { tranches?: unknown }).tranches) && (d as unknown as { tranches: unknown[] }).tranches.length > 0)))
              .slice(-1) // one drawing at a time: only the most recent one is kept
              .map((d) => {
                const old = d as unknown as { unit?: string; pay?: string; sell?: number; sells?: { price?: number }[]; sellPct?: number; tranches?: unknown };
                const unit: BuyUnit = old.unit === "USD" || old.unit === "EUR" ? old.unit : old.unit === "USDC" ? "USD" : "SOL";
                const pay = old.pay === "SOL" || old.pay === "USDC" ? old.pay : old.unit === "USDC" ? "USDC" : null;
                const hasBuy = typeof d.buy === "number";
                // A draft saved while staggered selling still existed may carry a `sells` array instead of a
                // single `sell` — only its first tranche's price survives (this is a local, unsent draft, never a real order).
                const legacySell = typeof old.sell === "number" ? old.sell : old.sells?.[0]?.price;
                let tranches: Tranche[] | undefined;
                if (!hasBuy) {
                  if (Array.isArray(old.tranches)) {
                    tranches = old.tranches.filter(
                      (t): t is Tranche => !!t && typeof t === "object" && typeof (t as Tranche).id === "string" && typeof (t as Tranche).pct === "number" && ((t as Tranche).sell !== undefined || (t as Tranche).stop !== undefined)
                    );
                  } else if (legacySell !== undefined || d.stop !== undefined) {
                    // A draft from before percentage tranches existed (Part 2's flat 25/50/75/100 picker): becomes its own single tranche.
                    const pct = typeof old.sellPct === "number" && old.sellPct >= 1 && old.sellPct <= 100 ? old.sellPct : 100;
                    tranches = [{ id: newId(), pct, sell: legacySell, stop: d.stop }];
                  }
                }
                return { id: d.id, n: d.n, buy: d.buy, sell: hasBuy ? legacySell : undefined, stop: hasBuy ? d.stop : undefined, amount: typeof d.amount === "string" ? d.amount : "", unit, pay, tranches };
              })
          );
        }
      } catch {}
      loaded.current = true;
    });
  }, [mint]);

  useEffect(() => {
    if (!mint || !loaded.current) return;
    try {
      localStorage.setItem(storageKey(mint), JSON.stringify(drafts));
    } catch {}
  }, [drafts, mint]);

  // ── real quotes (token, SOL, USDC, EUR→USD, liquidity) ───────────────────────────────────────────
  useEffect(() => {
    if (!mint) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/strategy/quote?mint=${mint}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((q: Quote | null) => !cancelled && setQuote(q))
        .catch(() => !cancelled && setQuote(null));
    load();
    const t = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [mint]);

  // ── the wallet's balances of the two coins a strategy can be paid in ─────────────────────────────
  useEffect(() => {
    if (!connected || !publicKey) return;
    let cancelled = false;
    Promise.all([
      readConnection.getBalance(publicKey).then((l) => l / 1e9),
      readConnection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(USDC_MINT) }).then((r) => r.value.reduce((s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0)),
    ])
      .then(([sol, usdc]) => !cancelled && setBalances({ sol, usdc }))
      .catch(() => !cancelled && setBalances({ sol: null, usdc: null }));
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, readConnection, step]);

  // The wallet's balance of THIS coin: what a sell or a stop can sell (only shapes without a buy need it). The
  // `mint` filter makes the RPC look the mint's own program up, so a Token-2022 coin is read the same way as a
  // classic SPL one. It's the wallet's FREE balance: tokens already in an open order sit in Jupiter's vault.
  // Re-read every 30 s while the tab is visible and on coming back to it — a buy from the trade box next to
  // the chart (or another app) has to unlock "Venta"/"Stop" without a reload.
  const [balanceRead, setBalanceRead] = useState<{ key: string; amount: number | null; decimals: number | null } | null>(null);
  const balanceKey = connected && publicKey && mint ? `${publicKey.toBase58()}:${mint}` : "";
  useEffect(() => {
    if (!balanceKey || !publicKey) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      readConnection
        .getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(mint) })
        .then(
          (r) =>
            !cancelled &&
            setBalanceRead({
              key: balanceKey,
              amount: r.value.reduce((s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0),
              decimals: r.value[0]?.account.data.parsed?.info?.tokenAmount?.decimals ?? null,
            })
        )
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    // A buy / sell in the trade box just landed (TradingPanel's BALANCE_EVENT).
    window.addEventListener("panda:balance-changed", load);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("panda:balance-changed", load);
    };
  }, [balanceKey, publicKey, readConnection, mint, step]);
  // Only a read for THIS wallet and THIS coin counts: a disconnected wallet or a different coin is "not known yet".
  const walletBalance = balanceRead && balanceRead.key === balanceKey ? balanceRead.amount : null;

  // ── PANDA orders on this coin (server) — what's already promised stays in the wallet until it sells, so it is
  // subtracted here: a new line's % is of what ISN'T in another order yet. ─────────────────────────────────────────
  const [pandaList, setPandaList] = useState<OrdersList | null>(null);
  const refreshPanda = useCallback(async () => {
    if (!pandaEligible || !mint || !publicKey) return;
    let status: number | "network";
    let list: OrdersList | null = null;
    try {
      const res = await fetch(`/api/panda-orders/list?mint=${mint}`, { cache: "no-store" });
      status = res.status;
      if (res.ok) list = (await res.json()) as OrdersList;
    } catch {
      status = "network";
    }
    if (status === 200 && list) {
      setPandaList(list);
      hadAccess.current = true;
    }
    setServerAccess(accessFromStatus(status === 200 && !list ? "network" : status, hadAccess.current));
  }, [pandaEligible, mint, publicKey]);
  useEffect(() => {
    if (!pandaEligible || !connected) {
      Promise.resolve().then(() => setServerAccess("checking"));
      return;
    }
    Promise.resolve().then(refreshPanda);
    const t = setInterval(refreshPanda, 30_000);
    return () => clearInterval(t);
  }, [pandaEligible, connected, refreshPanda, publicKey]);
  // ── changes to live orders the user hasn't signed yet ("Guardar cambio") ─────────────────────────────────────────
  const [orderEdits, setOrderEdits] = useState<Record<string, OrderEdit>>({});
  const [savingEdit, setSavingEdit] = useState<string | null>(null);
  const pandaListRef = useRef<OrdersList | null>(null);
  useEffect(() => {
    pandaListRef.current = pandaList;
  }, [pandaList]);
  /** Merges `patch` into the tranche's pending change; whatever ends up equal to the live order is dropped again. */
  const patchOrderEdit = useCallback((groupId: string, trancheId: string, patch: Partial<Pick<OrderEdit, "sellUsd" | "stopUsd" | "pct">>) => {
    const legs = (pandaListRef.current?.orders ?? []).filter((o) => o.groupId === groupId && o.trancheId === trancheId && o.state === "active");
    if (legs.length === 0) return;
    const k = orderEditKey(groupId, trancheId);
    setOrderEdits((all) => {
      const next: OrderEdit = { ...(all[k] ?? { groupId, trancheId }), ...patch };
      const sell = legs.find((o) => o.leg === "sell");
      const stop = legs.find((o) => o.leg === "stop");
      if (!sell || next.sellUsd === sell.targetUsd) delete next.sellUsd;
      if (!stop || next.stopUsd === stop.targetUsd) delete next.stopUsd;
      if (next.pct === legs[0].pct) delete next.pct;
      const rest = { ...all };
      delete rest[k];
      return next.sellUsd === undefined && next.stopUsd === undefined && next.pct === undefined ? rest : { ...rest, [k]: next };
    });
  }, []);
  const clearOrderEdit = useCallback((k: string) => {
    setOrderEdits((all) => {
      const rest = { ...all };
      delete rest[k];
      return rest;
    });
  }, []);

  const committedUi = useMemo(() => {
    const raw = pandaList?.committedRaw ? Number(pandaList.committedRaw) : 0;
    const decimals = balanceRead?.decimals ?? pandaList?.orders[0]?.tokenDecimals ?? null;
    return raw > 0 && decimals !== null ? raw / 10 ** decimals : 0;
  }, [pandaList, balanceRead]);
  const tokenBalance = walletBalance === null ? null : pandaMode ? Math.max(0, walletBalance - committedUi) : walletBalance;
  const heldStatus = heldStatusOf(tokenBalance);

  // ── saved strategies (server) ────────────────────────────────────────────────────────────────────
  const refreshList = useCallback(async () => {
    if (!mint || !publicKey) return;
    try {
      const res = await fetch(`/api/strategy/list?mint=${mint}`, { cache: "no-store" });
      if (res.status === 401) {
        setNeedsSignIn(true);
        return;
      }
      const data = (await res.json()) as { strategies?: StrategyRecord[] };
      setNeedsSignIn(false);
      setRecords(data.strategies ?? []);
    } catch {}
  }, [mint, publicKey]);

  useEffect(() => {
    if (!connected) return;
    Promise.resolve().then(refreshList);
  }, [connected, refreshList]);

  // ── Jupiter's own sign-in (a free message signature; the token stays in memory) ──────────────────
  const ensureJwt = useCallback(async (): Promise<string> => {
    if (jwt.current && Date.now() - jwt.current.at < JWT_TTL_MS) return jwt.current.token;
    if (!publicKey || !signMessage) throw new Error("NO_MESSAGE_SIGNING");
    const wallet = publicKey.toBase58();
    const c = await fetch("/api/jupiter/trigger/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletPubkey: wallet }) });
    const challenge = await c.json();
    if (!c.ok || challenge.type !== "message") throw new Error(challenge.error || "JUPITER_CHALLENGE");
    const signature = bs58.encode(await signMessage(new TextEncoder().encode(challenge.challenge)));
    const v = await fetch("/api/jupiter/trigger/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletPubkey: wallet, signature }) });
    const verified = await v.json();
    if (!v.ok || !verified.token) throw new Error(verified.error || "JUPITER_VERIFY");
    jwt.current = { token: verified.token, at: Date.now() };
    return verified.token as string;
  }, [publicKey, signMessage]);

  // ── derived: numbers for each draft ──────────────────────────────────────────────────────────────
  const rates: Rates = useMemo(() => ({ solUsd: quote?.solUsd ?? null, usdcUsd: quote?.usdcUsd ?? null, eurUsd: quote?.eurUsd ?? null }), [quote]);
  const currentUsd = quote?.tokenUsd ?? (chartPrice > 0 ? chartPrice : null);

  const views: DraftView[] = useMemo(
    () =>
      drafts.map((draft) => {
        const value = parseFloat(draft.amount);
        const amountUsd = Number.isFinite(value) ? amountToUsd(draft.unit, value, rates) : null;
        const funding = value > 0 ? chooseFunding({ unit: draft.unit, value, rates, balances, preferred: draft.pay, feeBps: STRATEGY_FEE_BPS }) : null;
        const asset: FundingAsset = funding?.ok ? funding.funding.asset : draft.unit === "SOL" ? "SOL" : draft.pay ?? preferredFunding(balances, rates);

        if (draft.buy === undefined) {
          // A held-coin draft: any number of percentage tranches (allocation.ts), each its own order shape —
          // there is no single `kind` for the whole draft any more, see `tranches` below.
          const tranches = draft.tranches ?? [];
          const balanceUsd = tokenBalance !== null && currentUsd !== null ? tokenBalance * currentUsd : null;
          // A PANDA order has no $10 floor and doesn't depend on Jupiter's liquidity rules: it only executes if the
          // curve/pool pays what the user signed. Jupiter's held-coin path keeps both checks.
          // Held-coin lines are only ever PANDA orders: PANDA's rules (no $10 minimum, no pool-liquidity floor).
          const trancheIssues = validateTranches(tranches, { currentUsd, balanceUsd, minOrderUsd: 0 });
          const tv: TrancheView[] = tranches.map((t) => {
            const issues = trancheIssues.get(t.id) ?? [];
            return { tranche: t, kind: trancheKind(t), issues, ready: issues.length === 0 };
          });
          const ready = tv.length > 0 && tv.every((v) => v.ready);
          return { draft, asset, amountUsd: null, funding: null, issues: [], metrics: null, ready, kind: null, tranches: tv, allocatedPct: sumAllocatedPct(tranches), remainingPct: sumRemainingPct(tranches), tokenBalance };
        }

        const legs = { buy: draft.buy, sell: draft.sell, stop: draft.stop };
        const kind = kindOf(legs);
        const complete = kind !== null;

        const issues: KindIssue[] = [];
        let metrics: StrategyMetrics | null = null;
        if (kind === "buy_sell_stop") {
          issues.push(...validateStrategy({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, currentUsd, liquidityUsd: quote ? quote.liquidityUsd : undefined }));
          if (amountUsd !== null && !issues.includes("invalid_price") && draft.buy! > 0) {
            metrics = strategyMetrics({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, feeUsd: (amountUsd * STRATEGY_FEE_BPS) / 10_000 });
          }
        } else if (kind) {
          issues.push(...validateKind(kind, legs, { currentUsd, amountUsd, liquidityUsd: quote ? quote.liquidityUsd : undefined }));
        }
        const ready = complete && issues.length === 0 && !!funding?.ok;
        return { draft, asset, amountUsd, funding, issues, metrics, ready, kind, tranches: [], allocatedPct: 0, remainingPct: 100, tokenBalance };
      }),
    [drafts, rates, balances, currentUsd, quote, tokenBalance]
  );

  const lines: ChartLine[] = useMemo(() => {
    const out: ChartLine[] = [];
    for (const d of drafts) {
      const tag = `#${d.n}`;
      const active = d.id === activeId;
      if (d.buy) out.push({ key: `${d.id}-b`, groupId: d.id, kind: "buy", price: d.buy, tag, live: false, active });
      if (d.sell) out.push({ key: `${d.id}-s`, groupId: d.id, kind: "sell1", price: d.sell, tag, live: false, active });
      if (d.stop) out.push({ key: `${d.id}-x`, groupId: d.id, kind: "stop", price: d.stop, tag, live: false, active });
      for (const l of linesOf(d.tranches ?? [])) {
        out.push({ key: `${d.id}-l-${l.leg}-${l.lineId}`, groupId: d.id, kind: l.leg === "sell" ? "sell1" : "stop", price: l.price, tag, live: false, active, pct: l.pct, lineId: l.lineId, held: true });
      }
    }
    // Live (submitted) strategies: a multi-tranche one is several sibling StrategyRecords sharing `groupId` — the shared
    // buy/stop lines are drawn once (from whichever sibling is first), each sibling still draws its own sell line.
    const drawnGroupLines = new Set<string>();
    for (const r of records) {
      if (TERMINAL.includes(r.state) || r.state === "prepared" || r.state === "creating") continue;
      const gid = r.groupId ?? r.id;
      const legIndex = r.legIndex ?? 0;
      const legCount = r.legCount ?? 1;
      const tag = `#${r.n}`;
      if (!drawnGroupLines.has(gid)) {
        drawnGroupLines.add(gid);
        out.push({ key: `${gid}-b`, groupId: gid, kind: "buy", price: r.buyUsd ?? 0, tag, live: true, active: false });
        out.push({ key: `${gid}-x`, groupId: gid, kind: "stop", price: r.stopUsd ?? 0, tag, live: true, active: false });
      }
      out.push({
        key: `${r.id}-s`,
        groupId: gid,
        kind: sellTargetAt(legIndex),
        price: r.sellUsd ?? 0,
        tag: legCount > 1 ? `${tag}.${legIndex + 1}` : tag,
        live: true,
        active: false,
        pct: legCount > 1 ? r.legPct : undefined,
      });
    }
    // Live PANDA orders: each leg at the price the user drew.
    for (const o of pandaList?.orders ?? []) {
      if (o.state !== "active" && o.state !== "sending") continue;
      // An active order can be grabbed by its tag and moved: the change shows at once and waits for "Guardar cambio".
      const edit = orderEdits[orderEditKey(o.groupId, o.trancheId)];
      const moved = o.leg === "sell" ? edit?.sellUsd : edit?.stopUsd;
      const editable = o.state === "active" && pandaMode;
      out.push({
        key: `po-${o.id}`,
        groupId: o.groupId,
        kind: o.leg === "sell" ? "sell1" : "stop",
        price: moved ?? o.targetUsd,
        tag: `#${o.n}`,
        live: true,
        active: false,
        pct: edit?.pct ?? o.pct,
        held: true,
        lineId: editable ? `po:${o.id}` : undefined,
        order: editable ? { groupId: o.groupId, trancheId: o.trancheId, leg: o.leg } : undefined,
        edited: moved !== undefined || edit?.pct !== undefined,
      });
    }
    return out;
  }, [drafts, records, activeId, pandaList, orderEdits, pandaMode]);

  // ── editing drafts ───────────────────────────────────────────────────────────────────────────────
  // Only what's actually visible right now (current drafts + live records) counts toward the next number —
  // a cancelled/failed/completed strategy from earlier is gone from the list, so it must not make a brand
  // new first draft show up labelled "#2" with no "#1" anywhere on screen.
  const nextNumber = useCallback(
    () =>
      Math.max(0, ...drafts.map((d) => d.n), ...records.filter((r) => !TERMINAL.includes(r.state)).map((r) => r.n), ...(pandaList?.orders ?? []).filter((o) => LIVE.has(o.state)).map((o) => o.n)) + 1,
    [drafts, records, pandaList]
  );

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))), []);

  const newDraft = useCallback((): Draft => {
    const d: Draft = { id: newId(), n: nextNumber(), amount: "", unit: readUnit(), pay: null };
    setDrafts((ds) => [...ds, d]);
    setActiveId(d.id);
    return d;
  }, [nextNumber]);

  /** Fills a brand-new draft straight from the AI assistant's structured output (src/app/api/ai/draw-trade) —
   *  exactly like one drawn by hand or typed into the price boxes, so it goes through the SAME validation
   *  (views, below) and still needs the user's own review and "Confirmar estrategia" tap; nothing here ever
   *  signs or submits anything. Returns the new draft's id. */
  const applyAiDraft = useCallback(
    (patch: { buy: number; stop: number; sell: number }): string => {
      const d = newDraft();
      setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, buy: patch.buy, stop: patch.stop, sell: patch.sell } : x)));
      return d.id;
    },
    [newDraft]
  );

  const active = drafts.find((d) => d.id === activeId) ?? null;
  /** The one drawing shown: the active one, else the most recent. */
  const current = active ?? drafts[drafts.length - 1] ?? null;

  const startTarget = useCallback(
    (target: DrawTarget) => {
      setError(null);
      setNotice(null);
      // Venta/Stop with no buy drawn: sells and stops on the coin the wallet ALREADY holds — no purchase needed.
      // The tab stays picked: every tap on the chart adds a line at the % marked in the row of buttons, read at
      // the moment of the tap (allocation.ts's placeLine pairs a stop with sells into oco orders).
      if (target !== "buy" && !current?.buy) {
        if (heldStatus !== "has") return;
        const leg = target === "stop" ? "stop" : "sell";
        const d = pickHeldDraft(drafts, current?.id ?? null) ?? newDraft();
        setActiveId(d.id);
        pendingTrancheRef.current = { mode: "place", leg };
        modeRef.current = { target: leg === "sell" ? "sell1" : "stop", held: true };
        setMachine(start(leg === "sell" ? "sell1" : "stop"));
        // Each type has its own room: a % that fits sells may not fit stops.
        if (selectedPct !== null && !fitsLeg(d.tranches ?? [], leg, selectedPct)) setSelectedPctState(null);
        if (selectedPct === null || !fitsLeg(d.tranches ?? [], leg, selectedPct)) setPickPctHint(true);
        return;
      }
      pendingTrancheRef.current = null;
      modeRef.current = { target, held: false };
      let d: Draft | null = current;
      // "Compra" on a held-coin draft that already has % lines starts a separate buy strategy instead of
      // turning those lines into the legs of a purchase.
      if (d && target === "buy" && d.buy === undefined && (d.tranches?.length ?? 0) > 0) d = null;
      if (!d) {
        const empty = [...drafts].reverse().find((x) => x.buy === undefined && !(x.tranches && x.tranches.length > 0));
        if (empty) {
          d = empty;
          setActiveId(empty.id);
        } else d = newDraft();
      } else setActiveId(d.id);
      setMachine(start(target));
    },
    [current, drafts, heldStatus, newDraft, setMachine, selectedPct]
  );

  const addStrategy = useCallback(() => {
    newDraft();
    setError(null);
    setNotice(null);
    // Nothing is armed yet: a brand new draft could become a bought strategy (the "Compra" tab) or a
    // held-coin tranche (its own % buttons, shown right away since it has no buy) — arming "buy" by default
    // would show a misleading "fija el precio de compra" status on a draft the user might only want to sell from.
    setMachine(IDLE);
  }, [newDraft, setMachine]);

  const cancelDrawing = useCallback(() => {
    pendingTrancheRef.current = null;
    modeRef.current = null;
    setMachine(IDLE);
    // Backing out of the very first BUY leaves nothing behind — but only when it was ALSO never going to be a
    // held-coin draft (no tranches drawn on it either).
    if (activeId) setDrafts((ds) => ds.filter((d) => !(d.id === activeId && d.buy === undefined && !(d.tranches && d.tranches.length > 0))));
    setActiveId((id) => (id && drafts.find((d) => d.id === id)?.buy === undefined && !drafts.find((d) => d.id === id)?.tranches?.length ? null : id));
  }, [activeId, drafts, setMachine]);

  /** Takes one leg back out of a draft ("x" next to it). The draft itself stays, even when it is left empty.
   *  Only for a BUY-including draft — a held-coin draft's tranches are each removed on their own (below). */
  const clearLeg = useCallback((id: string, target: DrawTarget) => {
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.id !== id) return d;
        if (target === "buy") return { ...d, buy: undefined };
        if (target === "stop") return { ...d, stop: undefined };
        return { ...d, sell: undefined };
      })
    );
  }, []);

  // ── percentage tranches (a held coin's "venta por porcentaje dibujando") ────────────────────────
  /** A typed price moves the whole line, same as dragging it on the chart. */
  const setLinePrice = useCallback((draftId: string, leg: "sell" | "stop", lineId: string, value: string) => {
    const p = roundPrice(parseFloat(value));
    if (p > 0) setDrafts((ds) => ds.map((d) => (d.id === draftId ? { ...d, tranches: updateLinePrice(d.tranches ?? [], leg, lineId, p) } : d)));
  }, []);

  /** The × on a line's card: the whole line goes, from every tranche it spans. */
  const removeLine = useCallback((draftId: string, leg: "sell" | "stop", lineId: string) => {
    setDrafts((ds) => ds.map((d) => (d.id === draftId ? { ...d, tranches: removeLineFrom(d.tranches ?? [], leg, lineId) } : d)));
  }, []);

  const removeTranche = useCallback((draftId: string, trancheId: string) => {
    setDrafts((ds) => ds.map((d) => (d.id === draftId ? { ...d, tranches: removeTrancheFrom(d.tranches ?? [], trancheId) } : d)));
  }, []);

  const setTranchePct = useCallback((draftId: string, trancheId: string, pct: number) => {
    setDrafts((ds) => ds.map((d) => (d.id === draftId ? { ...d, tranches: setTranchePctOf(d.tranches ?? [], trancheId, pct) } : d)));
  }, []);

  const applyPrice = useCallback((id: string, target: DrawTarget, price: number) => {
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.id !== id) return d;
        if (target === "buy") return { ...d, buy: price };
        if (target === "stop") return { ...d, stop: price };
        return { ...d, sell: price };
      })
    );
    setNotice({ kind: target, price });
  }, []);

  /** A price typed by hand goes through the same place as a drawn one. */
  const setPrice = useCallback(
    (id: string, target: DrawTarget, value: string) => {
      const p = roundPrice(parseFloat(value));
      if (p > 0) applyPrice(id, target, p);
    },
    [applyPrice]
  );

  const removeDraft = useCallback(
    (id: string) => {
      setDrafts((ds) => ds.filter((d) => d.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMachine(IDLE);
      }
    },
    [activeId, setMachine]
  );

  // ── the gesture, from the chart ──────────────────────────────────────────────────────────────────
  const onPointer = useCallback(
    (phase: "move" | "down" | "up" | "leave", price: number, info: { type: string; button: number; pressed: boolean }) => {
      const s = machineRef.current;
      if (!s.target) {
        // A tap on the chart with nothing armed, on a held coin and no % marked yet: say what's missing.
        if (phase === "up" && selectedPct === null && heldStatus === "has" && !current?.buy) setPickPctHint(true);
        return;
      }
      const p = roundPrice(price);
      if (phase === "leave") return setMachine(abort(s));
      if (p <= 0) return;
      if (phase === "move") return setMachine(move(s, p, { ...info, pressed: info.pressed }));
      if (phase === "down") return setMachine(down(s, p, info));
      const r = up(s, p, info);
      const pending = pendingTrancheRef.current;
      // After every tap the picked tab stays armed (sticky mode); after a drag, whatever was armed before comes back.
      const rearm = () => {
        const m = modeRef.current;
        pendingTrancheRef.current = m?.held ? { mode: "place", leg: m.target === "stop" ? "stop" : "sell" } : null;
        setMachine(m ? start(m.target) : IDLE);
      };
      if (r.picked !== null && pending?.mode === "order") {
        // A live order's line was dropped somewhere else: nothing is sent — the change waits for "Guardar cambio".
        patchOrderEdit(pending.groupId, pending.trancheId, pending.leg === "sell" ? { sellUsd: r.picked } : { stopUsd: r.picked });
        rearm();
      } else if (r.picked !== null && activeId) {
        if (pending?.mode === "place") {
          const pct = selectedPctRef.current;
          const tranches = drafts.find((d) => d.id === activeId)?.tranches ?? [];
          if (pct === null || !fitsLeg(tranches, pending.leg, pct)) {
            // No % marked, or the marked one doesn't fit any more: no line, and say so.
            if (pct !== null) setSelectedPctState(null);
            setPickPctHint(true);
          } else {
            const next = placeLine(tranches, pending.leg, pct, r.picked);
            setDrafts((ds) => ds.map((d) => (d.id === activeId ? { ...d, tranches: next } : d)));
            setNotice({ kind: pending.leg === "sell" ? "sell1" : "stop", price: r.picked });
            // The marked % no longer fits another line of this type: unmark it rather than let it fail on the next tap.
            if (!fitsLeg(next, pending.leg, pct)) {
              setSelectedPctState(null);
              setPickPctHint(true);
            }
          }
          rearm();
        } else if (pending?.mode === "drag") {
          setDrafts((ds) => ds.map((d) => (d.id === activeId ? { ...d, tranches: updateLinePrice(d.tranches ?? [], pending.leg, pending.lineId, r.picked!) } : d)));
          setNotice({ kind: pending.leg === "sell" ? "sell1" : "stop", price: r.picked });
          rearm();
        } else {
          // A buy strategy has one buy, one sell and one stop: a tap places (or moves) the line of the picked tab, which stays picked.
          applyPrice(activeId, s.target, r.picked);
          setMachine(start(s.target));
        }
      } else {
        setMachine(r.state);
      }
    },
    [activeId, applyPrice, setMachine, selectedPct, heldStatus, current, drafts, patchOrderEdit]
  );

  /** Grabs an already-placed tranche leg's line (its tag on the chart) and starts repositioning it right away —
   *  the same press-drag-release the user already knows from placing a brand new line, just seeded on an
   *  existing one instead of creating a new tranche when it's released. `price`/`info` are the SAME pointerdown
   *  that triggered the grab, fed straight into the machine so the line starts following the pointer at once. */
  const startTrancheDrag = useCallback(
    (draftId: string, lineId: string, leg: "sell" | "stop", price: number, info: { type: string; button: number }) => {
      setActiveId(draftId);
      pendingTrancheRef.current = { mode: "drag", lineId, leg };
      setError(null);
      setNotice(null);
      setMachine(start(leg === "sell" ? "sell1" : "stop"));
      onPointer("down", price, { ...info, pressed: true });
    },
    [setMachine, onPointer]
  );

  /** The same grab, on a LIVE PANDA order's line: releasing it leaves a pending change, never an order by itself. */
  const startOrderDrag = useCallback(
    (order: { groupId: string; trancheId: string; leg: "sell" | "stop" }, price: number, info: { type: string; button: number }) => {
      pendingTrancheRef.current = { mode: "order", ...order };
      setError(null);
      setNotice(null);
      setMachine(start(order.leg === "sell" ? "sell1" : "stop"));
      onPointer("down", price, { ...info, pressed: true });
    },
    [setMachine, onPointer]
  );

  // Escape leaves drawing mode.
  useEffect(() => {
    if (!machine.target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      pendingTrancheRef.current = null;
      modeRef.current = null;
      setMachine(IDLE);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [machine.target, setMachine]);

  // ── confirm: sign in, PREPARE the deposit (server call only, nothing to sign yet), then ONE
  // signAllTransactions for the deposit + fee together (a single wallet approval, on Phantom and Solflare
  // alike — both support batched signing; a wallet that doesn't falls back to one approval per transaction),
  // then submit. One draft is always exactly one real Jupiter order now.
  const confirm = useCallback(
    async (view: DraftView) => {
      const d = view.draft;
      if (!view.ready || !coin || !signTransaction) return;
      setError(null);
      try {
        setStep("session");
        await ensureSession();
        setStep("jupiter");
        const token = await ensureJwt();
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
        const value = parseFloat(d.amount);

        setStep("prepare");
        const prep = await fetch("/api/strategy/prepare", {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: d.id,
            n: d.n,
            mint: coin.mint,
            ticker: coin.ticker,
            buyUsd: d.buy,
            sellUsd: d.sell,
            stopUsd: d.stop,
            amount: { unit: d.unit, value },
            fundingAsset: view.asset,
          }),
        });
        const p = await prep.json();
        if (!prep.ok) throw new ApiError(p.error, p.code, p.issues);
        const deposit = base64ToVersionedTransaction(p.transaction);
        const feeTx = p.feeTransaction ? base64ToTransaction(p.feeTransaction) : null;

        setStep("sign");
        let signedDeposit: VersionedTransaction;
        let signedFee: Transaction | null = null;
        if (signAllTransactions && feeTx) {
          const [sd, sf] = await signAllTransactions([deposit, feeTx]);
          signedDeposit = sd as VersionedTransaction;
          signedFee = sf as Transaction;
        } else {
          signedDeposit = await signTransaction(deposit);
          if (feeTx) signedFee = await signTransaction(feeTx);
        }

        setStep("create");
        const created = await fetch("/api/strategy/create", {
          method: "POST",
          headers,
          body: JSON.stringify({ id: d.id, depositSignedTx: versionedTransactionToBase64(signedDeposit), feeSignedTx: signedFee ? transactionToBase64(signedFee) : undefined }),
        });
        const result = await created.json();
        if (!created.ok) throw new ApiError(result.error, result.code);

        setRecords((rs) => [...rs.filter((r) => r.id !== d.id), result.strategy as StrategyRecord]);
        setDrafts((ds) => ds.filter((x) => x.id !== d.id));
        setActiveId(null);
        setStep("done");
        setTimeout(() => setStep("idle"), 3500);
      } catch (err) {
        setStep("idle");
        if (err instanceof ApiError && err.code === "JUPITER_AUTH_REQUIRED") jwt.current = null;
        setError(err instanceof ApiError ? { message: err.message, code: err.code, issues: err.issues } : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      }
    },
    [coin, ensureJwt, ensureSession, signTransaction, signAllTransactions]
  );

  // ── PANDA orders: sign every sell / stop of a held-coin draft at once; PANDA keeps them (encrypted) and sends them
  // only when the price is reached. First time only: one extra approval creates the order accounts (a small deposit
  // per tranche, returned when cancelled or after it sells). ───────────────────────────────────────────────────────
  const sendAndConfirm = useCallback(
    async (base64: string): Promise<string> => {
      const tx = base64ToTransaction(base64);
      const sig = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await waitForSignature(connection, sig);
      return sig;
    },
    [connection, sendTransaction]
  );

  const confirmPanda = useCallback(
    async (view: DraftView, riskAccepted: boolean) => {
      const d = view.draft;
      const tranches = d.tranches ?? [];
      if (!view.ready || !coin || !signTransaction || tranches.length === 0) return;
      setError(null);
      const body = JSON.stringify({
        mint: coin.mint,
        ticker: coin.ticker,
        groupId: d.id,
        n: d.n,
        pool: coin.source === "pumpswap" ? coin.poolAddress : undefined,
        riskAccepted,
        tranches: tranches.map((t) => ({ trancheId: t.id, pct: t.pct, sellUsd: t.sell, stopUsd: t.stop })),
      });
      type Prepared = { phase: "setup"; transaction: string; nonceAccounts: string[] } | { phase: "orders"; orders: { id: string; transaction: string }[] };
      // The server checks the SOL and simulates every transaction BEFORE answering: when something would fail, this
      // throws with the reason and the wallet is never opened.
      const prepare = async (setupSignature?: string): Promise<Prepared> => {
        const res = await fetch("/api/panda-orders/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: setupSignature ? JSON.stringify({ ...JSON.parse(body), setupSignature }) : body });
        const data = await res.json();
        if (!res.ok) throw new ApiError(data.error, data.code, undefined, data.issues, data.detail);
        return data as Prepared;
      };
      try {
        setStep("session");
        await ensureSession();
        setStep("prepare");
        let p = await prepare();
        // First time on this wallet: the order accounts are created first (up to 5 per approval, so a draft with
        // more lines takes one more). Then the same request returns the orders themselves.
        // An account whose deposit this browser already sent is NEVER asked for again (creating it twice fails, and the
        // wallet shows a red warning for it): if the server doesn't see it yet, this waits and asks again.
        const created = new Set<string>();
        for (let rounds = 0; p.phase === "setup"; rounds++) {
          if (rounds >= 2) throw new ApiError("Order accounts not ready yet — try again.", "nonce_pending");
          setStep("setup");
          const setupSignature = await sendAndConfirm(p.transaction);
          for (const a of p.nonceAccounts) created.add(a);
          setStep("prepare");
          // The new accounts can take a moment to be visible to PANDA's RPC: short retries, up to ~40 s.
          for (let k = 0; ; k++) {
            try {
              p = await prepare(setupSignature);
              if (p.phase === "setup" && p.nonceAccounts.some((a) => created.has(a))) throw new ApiError("Order accounts not ready yet — try again.", "nonce_pending");
              break;
            } catch (err) {
              if (!(err instanceof ApiError && err.code === "nonce_pending") || k >= 15) throw err;
              await new Promise((r) => setTimeout(r, 2500));
            }
          }
        }
        setStep("signOrders");
        const txs = p.orders.map((o) => base64ToVersionedTransaction(o.transaction));
        const signed = signAllTransactions ? await signAllTransactions(txs) : await signOneByOne(txs, signTransaction);
        setStep("create");
        const orders = p.orders;
        const res = await fetch("/api/panda-orders/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: d.id, signed: orders.map((o, i) => ({ id: o.id, transaction: versionedTransactionToBase64(signed[i]) })) }),
        });
        const result = await res.json();
        if (!res.ok) throw new ApiError(result.error, result.code);
        setDrafts((ds) => ds.filter((x) => x.id !== d.id));
        setActiveId(null);
        await refreshPanda();
        setStep("doneOrders");
        setTimeout(() => setStep("idle"), 3500);
      } catch (err) {
        setStep("idle");
        setError(
          err instanceof ApiError
            ? { message: err.message, code: err.code, pandaIssues: err.pandaIssues, detail: err.detail }
            : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined }
        );
      }
    },
    [coin, ensureSession, signTransaction, signAllTransactions, sendAndConfirm, refreshPanda]
  );

  /** "Guardar cambio": ONE wallet approval swaps the live order for the changed one, on the same order account (no new
   *  deposit, nothing sent to the chain). Until it is signed — or if it is refused — the old order stays as it is. */
  const saveOrderEdit = useCallback(
    async (k: string, riskAccepted: boolean) => {
      const edit = orderEdits[k];
      if (!edit || !signTransaction) return;
      setError(null);
      setSavingEdit(k);
      try {
        await ensureSession();
        const res = await fetch("/api/panda-orders/modify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...edit, riskAccepted }) });
        const data = await res.json();
        if (!res.ok) throw new ApiError(data.error, data.code, undefined, data.issues, data.detail);
        const prepared = data.orders as { replaces: string; transaction: string; ticket: unknown }[];
        const txs = prepared.map((o) => base64ToVersionedTransaction(o.transaction));
        const signed = signAllTransactions && txs.length > 1 ? await signAllTransactions(txs) : await signOneByOne(txs, signTransaction);
        const sub = await fetch("/api/panda-orders/modify/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signed: prepared.map((o, i) => ({ replaces: o.replaces, ticket: o.ticket, transaction: versionedTransactionToBase64(signed[i]) })) }),
        });
        const result = await sub.json();
        if (!sub.ok) throw new ApiError(result.error, result.code);
        await refreshPanda();
        clearOrderEdit(k);
      } catch (err) {
        // "nothing" / "nonce_used": the order filled or was cancelled meanwhile — show what's really there now.
        if (err instanceof ApiError && (err.code === "nothing" || err.code === "nonce_used")) {
          clearOrderEdit(k);
          await refreshPanda();
        }
        setError(
          err instanceof ApiError
            ? { message: err.message, code: err.code, pandaIssues: err.pandaIssues, detail: err.detail }
            : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined }
        );
      } finally {
        setSavingEdit(null);
      }
    },
    [orderEdits, ensureSession, signTransaction, signAllTransactions, refreshPanda, clearOrderEdit]
  );

  /** The × on ONE line of a tranche that has both a sell and a stop: only that line goes; the other keeps working on
   *  the same order account. It takes a wallet signature like every cancel — a free message, nothing sent to the chain.
   *  (The last line of a tranche is cancelled with closePanda: that also gives the deposit back.) */
  const cancelPandaLeg = useCallback(
    async (orderId: string) => {
      setError(null);
      setCancelling(orderId);
      try {
        if (!signMessage) throw new ApiError("This wallet can't sign messages.", "no_sign_message");
        await ensureSession();
        const ask = await fetch("/api/panda-orders/cancel-leg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
        const asked = await ask.json();
        if (!ask.ok) throw new ApiError(asked.error, asked.code);
        const signature = await signMessage(new TextEncoder().encode(asked.message));
        const done = await fetch("/api/panda-orders/cancel-leg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, issuedAt: asked.issuedAt, signature: bs58.encode(signature) }) });
        const result = await done.json();
        if (!done.ok) throw new ApiError(result.error, result.code);
        await refreshPanda();
      } catch (err) {
        if (err instanceof ApiError && err.code === "nothing") await refreshPanda();
        setError(err instanceof ApiError ? { message: err.message, code: err.code } : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      } finally {
        setCancelling(null);
      }
    },
    [ensureSession, signMessage, refreshPanda]
  );

  /** Closes order accounts — a whole strategy, one tranche, or (`recover`) every free one: the deposit comes back to
   *  the wallet and any order signed on them can never execute. One approval. */
  const closePanda = useCallback(
    async (target: { groupId: string; trancheId?: string } | { recover: true } | { allOf: string }) => {
      setError(null);
      setCancelling("recover" in target ? "recover" : "allOf" in target ? "all" : target.trancheId ?? target.groupId);
      try {
        await ensureSession();
        const res = await fetch("/api/panda-orders/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target) });
        const data = await res.json();
        if (!res.ok) {
          if (data.code === "nothing") {
            await refreshPanda();
            return;
          }
          throw new ApiError(data.error, data.code);
        }
        await sendAndConfirm(data.transaction);
        await fetch("/api/panda-orders/closed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonceAccounts: data.nonceAccounts }) });
        await refreshPanda();
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      } finally {
        setCancelling(null);
      }
    },
    [ensureSession, sendAndConfirm, refreshPanda]
  );

  /** "Volver a firmar": a new draft with the same lines (same % and prices) as a strategy that stopped being valid. */
  const resignPanda = useCallback(
    (groupId: string) => {
      const legs = (pandaList?.orders ?? []).filter((o) => o.groupId === groupId);
      const byTranche = new Map<string, Tranche>();
      for (const o of legs) {
        const t = byTranche.get(o.trancheId) ?? { id: newId(), pct: o.pct };
        if (o.leg === "sell") t.sell = o.targetUsd;
        else t.stop = o.targetUsd;
        byTranche.set(o.trancheId, t);
      }
      const d = newDraft();
      setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, tranches: [...byTranche.values()] } : x)));
      setError(null);
    },
    [pandaList, newDraft]
  );

  const pandaGroups = useMemo(() => groupOrders((pandaList?.orders ?? []).filter((o) => o.state !== "prepared")), [pandaList]);

  // ── read back what Jupiter did (needs Jupiter's sign-in, so it is on demand) ─────────────────────
  const sync = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      await ensureSession();
      const token = await ensureJwt();
      const res = await fetch("/api/strategy/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new ApiError(data.error, data.code);
      setRecords((data.strategies as StrategyRecord[]).filter((s) => s.mint === mint));
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, code: err.code } : { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
    }
  }, [ensureJwt, ensureSession, mint]);

  // ── cancel a live strategy: Jupiter builds the withdrawal, the wallet signs it ───────────────────
  const cancelLive = useCallback(
    async (r: StrategyRecord) => {
      if (!r.jupiterOrderId || !signTransaction) return;
      setError(null);
      setCancelling(r.id);
      try {
        await ensureSession();
        const token = await ensureJwt();
        const craft = await fetch(`/api/jupiter/trigger/orders/${r.jupiterOrderId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const crafted = await craft.json();
        if (!craft.ok) throw new ApiError(crafted.error);
        const signed = await signTransaction(base64ToVersionedTransaction(crafted.transaction));
        const done = await fetch(`/api/jupiter/trigger/orders/${r.jupiterOrderId}/confirm-cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ signedTransaction: versionedTransactionToBase64(signed), cancelRequestId: crafted.requestId }),
        });
        if (!done.ok) throw new ApiError((await done.json()).error);
        await sync();
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      } finally {
        setCancelling(null);
      }
    },
    [ensureJwt, ensureSession, signTransaction, sync]
  );

  // ── Jupiter orders on this coin that Draw Your Trade didn't create (the old "Stop Loss / Take Profit" panel, now
  // gone): listed on request — reading them needs Jupiter's sign-in, a free message signature — and cancellable. ──
  const [otherOrders, setOtherOrders] = useState<TriggerOrder[] | null>(null);
  const [otherLoading, setOtherLoading] = useState(false);
  const loadOtherOrders = useCallback(async () => {
    if (!mint) return;
    setError(null);
    setOtherLoading(true);
    try {
      const token = await ensureJwt();
      const res = await fetch(`/api/jupiter/trigger/orders?state=active&mint=${mint}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json()) as { orders?: TriggerOrder[]; error?: string };
      if (!res.ok) throw new ApiError(data.error ?? "JUPITER_LIST");
      const ours = new Set(records.map((r) => r.jupiterOrderId).filter(Boolean));
      setOtherOrders((data.orders ?? []).filter((o) => !ours.has(o.id)));
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
    } finally {
      setOtherLoading(false);
    }
  }, [mint, ensureJwt, records]);

  const cancelOtherOrder = useCallback(
    async (orderId: string) => {
      if (!signTransaction) return;
      setError(null);
      setCancelling(orderId);
      try {
        const token = await ensureJwt();
        const craft = await fetch(`/api/jupiter/trigger/orders/${orderId}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const crafted = await craft.json();
        if (!craft.ok) throw new ApiError(crafted.error);
        const signed = await signTransaction(base64ToVersionedTransaction(crafted.transaction));
        const done = await fetch(`/api/jupiter/trigger/orders/${orderId}/confirm-cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ signedTransaction: versionedTransactionToBase64(signed), cancelRequestId: crafted.requestId }),
        });
        if (!done.ok) throw new ApiError((await done.json()).error);
        setOtherOrders((os) => (os ?? []).filter((o) => o.id !== orderId));
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      } finally {
        setCancelling(null);
      }
    },
    [ensureJwt, signTransaction]
  );

  // The notice is a short confirmation, not a permanent banner.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Saved strategies, grouped back into one card per drawn position — a 3-tranche strategy is 3 real
  // StrategyRecords underneath (see the confirm loop above) but ONE card here, tranches sorted in order.
  const recordGroups: RecordGroup[] = useMemo(() => {
    const live = records.filter((r) => r.state !== "prepared" && r.state !== "creating");
    const byGroup = new Map<string, StrategyRecord[]>();
    for (const r of live) {
      const gid = r.groupId ?? r.id;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(r);
    }
    return [...byGroup.entries()]
      .map(([groupId, legs]) => ({ groupId, n: legs[0].n, legs: [...legs].sort((a, b) => (a.legIndex ?? 0) - (b.legIndex ?? 0)) }))
      .sort((a, b) => b.n - a.n);
  }, [records]);

  return {
    clearLeg,
    tokenBalance,
    heldStatus,
    pandaMode,
    pandaAccess,
    pandaGroups,
    current,
    selectedPct,
    setSelectedPct,
    pickPctHint,
    freeNonces: pandaList?.freeNonces ?? [],
    freeDepositLamports: (pandaList?.freeNonces.length ?? 0) * (pandaList?.rentLamports ?? 0),
    confirmPanda,
    orderEdits,
    savingEdit,
    patchOrderEdit,
    clearOrderEdit,
    saveOrderEdit,
    startOrderDrag,
    cancelPandaLeg,
    closePanda,
    resignPanda,
    refreshPanda,
    strategiesOn: features.strategies,
    startTrancheDrag,
    setLinePrice,
    removeLine,
    removeTranche,
    setTranchePct,
    connected,
    quote,
    currentUsd,
    balances,
    drafts,
    views,
    records: records.filter((r) => r.state !== "prepared" && r.state !== "creating"),
    recordGroups,
    lines,
    active,
    activeId,
    machine,
    notice,
    needsSignIn,
    step,
    error,
    syncing,
    cancelling,
    engine: quote?.engine ?? false,
    setActiveId,
    patchDraft,
    setPrice,
    startTarget,
    addStrategy,
    applyAiDraft,
    cancelDrawing,
    removeDraft,
    onPointer,
    confirm,
    sync,
    cancelLive,
    otherOrders,
    otherLoading,
    loadOtherOrders,
    cancelOtherOrder,
    refreshList,
    signIn: async () => {
      try {
        await ensureSession();
        await Promise.all([refreshList(), refreshPanda()]);
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

export type DrawApi = ReturnType<typeof useDrawTrade>;

/** Only hit when the wallet doesn't support `signAllTransactions` at all — one approval per transaction instead of one for all of them. */
async function signOneByOne<T extends Transaction | VersionedTransaction>(txs: T[], signTransaction: <U extends Transaction | VersionedTransaction>(tx: U) => Promise<U>): Promise<T[]> {
  const out: T[] = [];
  for (const tx of txs) out.push(await signTransaction(tx));
  return out;
}

class ApiError extends Error {
  constructor(message: string, public code?: string, public issues?: StrategyIssue[], public pandaIssues?: Record<string, string[]>, public detail?: { needLamports: number; haveLamports: number }) {
    super(message);
  }
}

/** Polls the signature until it's confirmed (or fails, or a minute passes) — read methods PANDA's RPC proxy allows. */
async function waitForSignature(connection: Connection, signature: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const s = value[0];
    if (s?.err) throw new Error("The transaction failed on-chain.");
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The transaction wasn't confirmed in time — check your wallet before trying again.");
}

/** The unit last used to type an amount — shared with the buy box, so both start the way you left them. */
function readUnit(): BuyUnit {
  try {
    const u = localStorage.getItem("panda.buy.unit");
    if (u === "SOL" || u === "USD" || u === "EUR") return u;
  } catch {}
  return "SOL";
}

export function rememberUnit(u: BuyUnit) {
  try {
    localStorage.setItem("panda.buy.unit", u);
  } catch {}
}
