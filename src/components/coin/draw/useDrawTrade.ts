"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
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

export type ChartLine = { key: string; groupId: string; kind: DrawTarget; price: number; tag: string; live: boolean; active: boolean };

export type Quote = Rates & { tokenUsd: number | null; liquidityUsd: number | null; engine: boolean };

export type Step = "idle" | "session" | "jupiter" | "prepare" | "sign" | "create" | "done";

export type DraftView = {
  draft: Draft;
  /** The coin that will pay: the user's pick, else the one the wallet holds most of. */
  asset: FundingAsset;
  amountUsd: number | null;
  funding: FundingResult | null;
  issues: StrategyIssue[];
  metrics: StrategyMetrics | null;
  ready: boolean;
};

export type Notice = { kind: DrawTarget; price: number } | null;

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
                const old = d as unknown as { unit?: string; pay?: string };
                const unit: BuyUnit = old.unit === "USD" || old.unit === "EUR" ? old.unit : old.unit === "USDC" ? "USD" : "SOL";
                const pay = old.pay === "SOL" || old.pay === "USDC" ? old.pay : old.unit === "USDC" ? "USDC" : null;
                return { id: d.id, n: d.n, buy: d.buy, sell: d.sell, stop: d.stop, amount: typeof d.amount === "string" ? d.amount : "", unit, pay };
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
        const issues = complete ? validateStrategy({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, currentUsd, liquidityUsd: quote ? quote.liquidityUsd : undefined }) : [];
        const metrics = complete && amountUsd && !issues.includes("invalid_price") && draft.buy! > 0 ? strategyMetrics({ buy: draft.buy!, sell: draft.sell!, stop: draft.stop!, amountUsd, feeUsd: (amountUsd * STRATEGY_FEE_BPS) / 10_000 }) : null;
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
      if (d.sell) out.push({ key: `${d.id}-s`, groupId: d.id, kind: "sell", price: d.sell, tag, live: false, active });
      if (d.stop) out.push({ key: `${d.id}-x`, groupId: d.id, kind: "stop", price: d.stop, tag, live: false, active });
    }
    for (const r of records) {
      if (TERMINAL.includes(r.state) || r.state === "prepared" || r.state === "creating") continue;
      const tag = `#${r.n}`;
      out.push({ key: `${r.id}-b`, groupId: r.id, kind: "buy", price: r.buyUsd, tag, live: true, active: false });
      out.push({ key: `${r.id}-s`, groupId: r.id, kind: "sell", price: r.sellUsd, tag, live: true, active: false });
      out.push({ key: `${r.id}-x`, groupId: r.id, kind: "stop", price: r.stopUsd, tag, live: true, active: false });
    }
    return out;
  }, [drafts, records, activeId]);

  // ── editing drafts ───────────────────────────────────────────────────────────────────────────────
  const nextNumber = useCallback(() => Math.max(0, ...drafts.map((d) => d.n), ...records.map((r) => r.n)) + 1, [drafts, records]);

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))), []);

  const newDraft = useCallback((): Draft => {
    const d: Draft = { id: newId(), n: nextNumber(), amount: "", unit: readUnit(), pay: null };
    setDrafts((ds) => [...ds, d]);
    setActiveId(d.id);
    return d;
  }, [nextNumber]);

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
        if (target === "sell") return { ...d, sell: price };
        return { ...d, stop: price };
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
      setMachine(r.state);
      if (r.picked !== null && activeId) applyPrice(activeId, s.target, r.picked);
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

  // ── confirm: sign in, prepare on the server, the wallet signs the deposit, the server submits once ─
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
            amount: { unit: d.unit, value: parseFloat(d.amount) },
            fundingAsset: view.asset,
          }),
        });
        const prepared = await prep.json();
        if (!prep.ok) throw new ApiError(prepared.error, prepared.code, prepared.issues);

        // Two transactions, approved together: the deposit into Jupiter's vault, and PANDA's fee. Nothing is sent from here:
        // the server checks both, creates the order, and only then collects the fee.
        setStep("sign");
        const deposit = base64ToVersionedTransaction(prepared.transaction);
        const feeTx = prepared.feeTransaction ? base64ToTransaction(prepared.feeTransaction) : null;
        let signedDeposit: typeof deposit;
        let signedFee: typeof feeTx = null;
        if (feeTx && signAllTransactions) {
          const both = await signAllTransactions([deposit, feeTx]);
          signedDeposit = both[0] as typeof deposit;
          signedFee = both[1] as NonNullable<typeof feeTx>;
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

        setRecords((rs) => [...rs.filter((r) => r.id !== d.id), result.strategy]);
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

  return {
    connected,
    quote,
    currentUsd,
    balances,
    drafts,
    views,
    records: records.filter((r) => r.state !== "prepared" && r.state !== "creating"),
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
