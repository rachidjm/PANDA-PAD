"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Coin } from "@/lib/types";
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
import { TERMINAL, type StrategyRecord } from "@/lib/strategy/types";

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
  /** Set only on a sell tranche's own line: the % of the position it sells. */
  pct?: number;
};

export type Quote = Rates & { tokenUsd: number | null; liquidityUsd: number | null; priceChangeH1Pct: number | null; engine: boolean };

export type Step = "idle" | "session" | "jupiter" | "prepare" | "sign" | "create" | "done";

export type DraftView = {
  draft: Draft;
  /** The coin that will pay: the user's pick, else the one the wallet holds most of. */
  asset: FundingAsset;
  amountUsd: number | null;
  funding: FundingResult | null;
  issues: StrategyIssue[];
  /** Null until buy/sell/stop and a priced amount are all in. */
  metrics: StrategyMetrics | null;
  ready: boolean;
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
  const { connected, publicKey, signMessage, signTransaction, signAllTransactions } = useWallet();
  const { ensureSession } = useWalletSession();
  const mint = coin?.mint ?? "";

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [records, setRecords] = useState<StrategyRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [machine, setMachineState] = useState<DrawState>(IDLE);
  const machineRef = useRef<DrawState>(IDLE);
  const [notice, setNotice] = useState<Notice>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [balances, setBalances] = useState<{ sol: number | null; usdc: number | null }>({ sol: null, usdc: null });
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<{ message?: string; issues?: StrategyIssue[]; code?: string } | null>(null);
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
        // A draft with no BUY yet is just an empty box left behind: not worth keeping between visits.
        if (Array.isArray(parsed)) {
          setDrafts(
            parsed
              .filter((d) => d && typeof d.id === "string" && d.buy !== undefined)
              .slice(0, 20)
              .map((d) => {
                const old = d as unknown as { unit?: string; pay?: string; sell?: number; sells?: { price?: number }[] };
                const unit: BuyUnit = old.unit === "USD" || old.unit === "EUR" ? old.unit : old.unit === "USDC" ? "USD" : "SOL";
                const pay = old.pay === "SOL" || old.pay === "USDC" ? old.pay : old.unit === "USDC" ? "USDC" : null;
                // A draft saved while staggered selling still existed may carry a `sells` array instead of a
                // single `sell` — only its first tranche's price survives (this is a local, unsent draft, never a real order).
                const sell = typeof old.sell === "number" ? old.sell : old.sells?.[0]?.price;
                return { id: d.id, n: d.n, buy: d.buy, sell, stop: d.stop, amount: typeof d.amount === "string" ? d.amount : "", unit, pay };
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
        const complete = draft.buy !== undefined && draft.sell !== undefined && draft.stop !== undefined;

        const issues: StrategyIssue[] = [];
        let metrics: StrategyMetrics | null = null;
        if (complete) {
          issues.push(...validateStrategy({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, currentUsd, liquidityUsd: quote ? quote.liquidityUsd : undefined }));
          if (amountUsd !== null && !issues.includes("invalid_price") && draft.buy! > 0) {
            metrics = strategyMetrics({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, feeUsd: (amountUsd * STRATEGY_FEE_BPS) / 10_000 });
          }
        }
        return { draft, asset, amountUsd, funding, issues, metrics, ready: complete && issues.length === 0 && !!funding?.ok };
      }),
    [drafts, rates, balances, currentUsd, quote]
  );

  const lines: ChartLine[] = useMemo(() => {
    const out: ChartLine[] = [];
    for (const d of drafts) {
      const tag = `#${d.n}`;
      const active = d.id === activeId;
      if (d.buy) out.push({ key: `${d.id}-b`, groupId: d.id, kind: "buy", price: d.buy, tag, live: false, active });
      if (d.sell) out.push({ key: `${d.id}-s`, groupId: d.id, kind: "sell1", price: d.sell, tag, live: false, active });
      if (d.stop) out.push({ key: `${d.id}-x`, groupId: d.id, kind: "stop", price: d.stop, tag, live: false, active });
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
    return out;
  }, [drafts, records, activeId]);

  // ── editing drafts ───────────────────────────────────────────────────────────────────────────────
  // Only what's actually visible right now (current drafts + live records) counts toward the next number —
  // a cancelled/failed/completed strategy from earlier is gone from the list, so it must not make a brand
  // new first draft show up labelled "#2" with no "#1" anywhere on screen.
  const nextNumber = useCallback(
    () => Math.max(0, ...drafts.map((d) => d.n), ...records.filter((r) => !TERMINAL.includes(r.state)).map((r) => r.n)) + 1,
    [drafts, records]
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

  const startTarget = useCallback(
    (target: DrawTarget) => {
      let d = active;
      if (!d) {
        const empty = [...drafts].reverse().find((x) => x.buy === undefined);
        if (empty) {
          d = empty;
          setActiveId(empty.id);
        } else d = newDraft();
      } else setActiveId(d.id);
      setError(null);
      setNotice(null);
      setMachine(start(target));
    },
    [active, drafts, newDraft, setMachine]
  );

  const addStrategy = useCallback(() => {
    newDraft();
    setError(null);
    setNotice(null);
    setMachine(start("buy"));
  }, [newDraft, setMachine]);

  const cancelDrawing = useCallback(() => {
    setMachine(IDLE);
    // Backing out of the very first BUY leaves nothing behind.
    if (activeId) setDrafts((ds) => ds.filter((d) => !(d.id === activeId && d.buy === undefined)));
    setActiveId((id) => (id && drafts.find((d) => d.id === id)?.buy === undefined ? null : id));
  }, [activeId, drafts, setMachine]);

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
      if (!s.target) return;
      const p = roundPrice(price);
      if (phase === "leave") return setMachine(abort(s));
      if (p <= 0) return;
      if (phase === "move") return setMachine(move(s, p, { ...info, pressed: info.pressed }));
      if (phase === "down") return setMachine(down(s, p, info));
      const r = up(s, p, info);
      if (r.picked !== null && activeId) {
        applyPrice(activeId, s.target, r.picked);
        // Placing buy moves straight into sell, then straight into stop — three clicks/taps in one flow
        // instead of having to re-pick the tab after each one.
        const next = s.target === "buy" ? "sell1" : s.target === "sell1" ? "stop" : null;
        setMachine(next ? start(next) : r.state);
      } else {
        setMachine(r.state);
      }
    },
    [activeId, applyPrice, setMachine]
  );

  // Escape leaves drawing mode.
  useEffect(() => {
    if (!machine.target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMachine(IDLE);
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
    refreshList,
    signIn: async () => {
      try {
        await ensureSession();
        await refreshList();
      } catch (err) {
        setError({ message: err instanceof Error ? err.message : String(err) });
      }
    },
  };
}

export type DrawApi = ReturnType<typeof useDrawTrade>;

class ApiError extends Error {
  constructor(message: string, public code?: string, public issues?: StrategyIssue[]) {
    super(message);
  }
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
