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
  MAX_TRANCHES,
  maxTranchesFor,
  MIN_SELLS,
  preferredFunding,
  roundPrice,
  strategyMetrics,
  STRATEGY_FEE_BPS,
  trancheDollarIssues,
  USDC_MINT,
  validateSellPcts,
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

/** One sell target: its own price, and the whole percent of the position it sells (every tranche's `pct` sums to 100). */
export type SellTranche = { price?: number; pct: number };

export type Draft = {
  id: string;
  n: number;
  buy?: number;
  /** "Venta escalonada" — OFF by default. Off: exactly one tranche, always at 100%. On: 1 to MAX_TRANCHES
   *  tranches, each its own % of the position (all start at 100% — see plan.ts's MIN_TRANCHE_USD). */
  staggered: boolean;
  sells: SellTranche[];
  stop?: number;
  amount: string;
  /** What the amount is typed in. */
  unit: BuyUnit;
  /** The coin that pays when the amount is in dollars or euros. null = the one the wallet holds most of. */
  pay: FundingAsset | null;
};

export type BuyUnit = Extract<AmountUnit, "SOL" | "USD" | "EUR">;

/** 0-based index of a sell tranche target ("sell1" → 0, "sell2" → 1, … up to MAX_TRANCHES); -1 for "buy"/"stop". */
export function sellIndexOf(target: DrawTarget): number {
  const m = /^sell(\d+)$/.exec(target);
  return m ? Number(m[1]) - 1 : -1;
}
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
  /** One entry per sell tranche, same order as draft.sells — each priced on its own slice of amountUsd. */
  legMetrics: (StrategyMetrics | null)[];
  /** Sums across every tranche — "if every one of them sells exactly at its own target" / "PANDA's total fee". Null until every tranche has real numbers. */
  totalNetProfitUsd: number | null;
  totalFeeUsd: number | null;
  /** How many tranches the typed amount can actually support (each at least MIN_TRANCHE_USD) — "+ venta" is disabled past this. */
  maxTranchesAllowed: number;
  /** Same order as draft.sells: true where that tranche's own dollar share is under MIN_TRANCHE_USD (only meaningful with more than one tranche). */
  trancheTooSmall: boolean[];
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
  const [legProgress, setLegProgress] = useState<{ index: number; total: number } | null>(null);
  const [error, setError] = useState<{ message?: string; issues?: StrategyIssue[]; code?: string; partial?: { done: number; total: number; rolledBack?: number; stillOpen?: number } } | null>(null);
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
                const old = d as unknown as { unit?: string; pay?: string; sell?: number; sells?: SellTranche[]; staggered?: boolean };
                const unit: BuyUnit = old.unit === "USD" || old.unit === "EUR" ? old.unit : old.unit === "USDC" ? "USD" : "SOL";
                const pay = old.pay === "SOL" || old.pay === "USDC" ? old.pay : old.unit === "USDC" ? "USDC" : null;
                // A draft saved before multi-sell existed has a single `sell` number — becomes one 100% tranche.
                const sells: SellTranche[] = Array.isArray(old.sells) && old.sells.length > 0 ? old.sells : [{ price: old.sell, pct: 100 }];
                const staggered = typeof old.staggered === "boolean" ? old.staggered : sells.length > 1;
                return { id: d.id, n: d.n, buy: d.buy, staggered, sells, stop: d.stop, amount: typeof d.amount === "string" ? d.amount : "", unit, pay };
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
        const complete = draft.buy !== undefined && draft.stop !== undefined && draft.sells.length > 0 && draft.sells.every((s) => s.price !== undefined);

        const issues: StrategyIssue[] = [];
        const legMetrics: (StrategyMetrics | null)[] = [];
        const maxTranchesAllowed = Math.min(MAX_TRANCHES, maxTranchesFor(amountUsd));
        const trancheTooSmall = trancheDollarIssues(draft.sells, amountUsd);
        if (complete) {
          for (const iss of validateSellPcts(draft.sells)) issues.push(iss);
          if (trancheTooSmall.some(Boolean)) issues.push("tranche_below_minimum");
          for (const s of draft.sells) {
            const legAmountUsd = amountUsd !== null ? (amountUsd * s.pct) / 100 : null;
            // A single tranche is checked at the plain $10 floor (validateStrategy's own below_minimum); with
            // more than one, the tighter $11-per-tranche check above already covers it — skip the double-count.
            const legIssues = validateStrategy({ buy: draft.buy!, sell: s.price!, stop: draft.stop!, amountUsd: legAmountUsd, currentUsd, liquidityUsd: quote ? quote.liquidityUsd : undefined }).filter(
              (iss) => !(iss === "below_minimum" && draft.sells.length > 1)
            );
            for (const iss of legIssues) if (!issues.includes(iss)) issues.push(iss);
            legMetrics.push(
              legAmountUsd && !legIssues.includes("invalid_price") && draft.buy! > 0
                ? strategyMetrics({ buy: draft.buy!, sell: s.price!, stop: draft.stop!, amountUsd: legAmountUsd, feeUsd: (legAmountUsd * STRATEGY_FEE_BPS) / 10_000 })
                : null
            );
          }
        }
        const everyLegPriced = legMetrics.length > 0 && legMetrics.every((m): m is StrategyMetrics => m !== null);
        const totalNetProfitUsd = everyLegPriced ? legMetrics.reduce((s, m) => s + m!.netProfitUsd, 0) : null;
        const totalFeeUsd = everyLegPriced ? legMetrics.reduce((s, m) => s + m!.feeUsd, 0) : null;
        return { draft, asset, amountUsd, funding, issues, legMetrics, totalNetProfitUsd, totalFeeUsd, maxTranchesAllowed, trancheTooSmall, ready: complete && issues.length === 0 && !!funding?.ok };
      }),
    [drafts, rates, balances, currentUsd, quote]
  );

  const lines: ChartLine[] = useMemo(() => {
    const out: ChartLine[] = [];
    for (const d of drafts) {
      const tag = `#${d.n}`;
      const active = d.id === activeId;
      if (d.buy) out.push({ key: `${d.id}-b`, groupId: d.id, kind: "buy", price: d.buy, tag, live: false, active });
      d.sells.forEach((s, i) => {
        if (s.price) out.push({ key: `${d.id}-s${i}`, groupId: d.id, kind: sellTargetAt(i), price: s.price, tag: d.sells.length > 1 ? `${tag}.${i + 1}` : tag, live: false, active, pct: d.sells.length > 1 ? s.pct : undefined });
      });
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
        out.push({ key: `${gid}-b`, groupId: gid, kind: "buy", price: r.buyUsd, tag, live: true, active: false });
        out.push({ key: `${gid}-x`, groupId: gid, kind: "stop", price: r.stopUsd, tag, live: true, active: false });
      }
      out.push({
        key: `${r.id}-s`,
        groupId: gid,
        kind: sellTargetAt(legIndex),
        price: r.sellUsd,
        tag: legCount > 1 ? `${tag}.${legIndex + 1}` : tag,
        live: true,
        active: false,
        pct: legCount > 1 ? r.legPct : undefined,
      });
    }
    return out;
  }, [drafts, records, activeId]);

  // ── editing drafts ───────────────────────────────────────────────────────────────────────────────
  const nextNumber = useCallback(() => Math.max(0, ...drafts.map((d) => d.n), ...records.map((r) => r.n)) + 1, [drafts, records]);

  const patchDraft = useCallback((id: string, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d))), []);

  const newDraft = useCallback((): Draft => {
    const d: Draft = { id: newId(), n: nextNumber(), staggered: false, sells: [{ pct: 100 }], amount: "", unit: readUnit(), pay: null };
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
        if (target === "stop") return { ...d, stop: price };
        const idx = sellIndexOf(target);
        return { ...d, sells: d.sells.map((s, i) => (i === idx ? { ...s, price } : s)) };
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

  /** "Venta escalonada" on/off. Off collapses back to exactly one tranche at 100% (keeping its price, if any) —
   *  the plain, non-staggered behaviour. On just reveals the per-tranche % boxes and "+ venta"; the tranches
   *  themselves don't change. */
  const setStaggered = useCallback((id: string, on: boolean) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? (on ? { ...d, staggered: true } : { ...d, staggered: false, sells: [{ price: d.sells[0]?.price, pct: 100 }] }) : d)));
  }, []);

  /** Adds a sell tranche, up to `maxAllowed` (the caller passes the amount-based cap from the draft's own
   *  view — see plan.ts's maxTranchesFor). Every box starts at 100%, same as the first one: nothing is
   *  auto-redistributed, so "Total: …% · debe sumar 100%" always reflects exactly what's on screen. */
  const addSellTranche = useCallback((id: string, maxAllowed: number) => {
    setDrafts((ds) => ds.map((d) => (d.id === id && d.sells.length < Math.min(MAX_TRANCHES, maxAllowed) ? { ...d, sells: [...d.sells, { pct: 100 }] } : d)));
  }, []);

  /** Removes a sell tranche outright — the rest keep whatever % they already had (never below MIN_SELLS). */
  const removeSellTranche = useCallback((id: string, index: number) => {
    setDrafts((ds) => ds.map((d) => (d.id === id && d.sells.length > MIN_SELLS ? { ...d, sells: d.sells.filter((_, i) => i !== index) } : d)));
  }, []);

  /** A tranche's own % of the position, typed by hand. */
  const setSellPct = useCallback((id: string, index: number, pct: number) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, sells: d.sells.map((s, i) => (i === index ? { ...s, pct } : s)) } : d)));
  }, []);

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

  // ── rolls back a set of already-created tranches: crafts every cancel first (server calls only), then ONE
  // signAllTransactions for the whole batch (same "one popup" approach as confirm() itself), then confirms
  // each. Best-effort: whatever can't be cancelled is returned in `failed` and stays visible as a real, live
  // order — never silently hidden — so the user can cancel it by hand from the list.
  const autoCancelLegs = useCallback(
    async (recs: StrategyRecord[]): Promise<{ cancelled: string[]; failed: string[] }> => {
      if (recs.length === 0 || !signTransaction) return { cancelled: [], failed: recs.map((r) => r.id) };
      try {
        const token = await ensureJwt();
        const headers = { Authorization: `Bearer ${token}` };
        const crafts: { id: string; orderId: string; tx: VersionedTransaction; requestId: string }[] = [];
        for (const r of recs) {
          if (!r.jupiterOrderId) continue;
          const craft = await fetch(`/api/jupiter/trigger/orders/${r.jupiterOrderId}/cancel`, { method: "POST", headers });
          if (!craft.ok) continue;
          const c = await craft.json();
          crafts.push({ id: r.id, orderId: r.jupiterOrderId, tx: base64ToVersionedTransaction(c.transaction), requestId: c.requestId });
        }
        if (crafts.length === 0) return { cancelled: [], failed: recs.map((r) => r.id) };
        const signedTxs = signAllTransactions ? await signAllTransactions(crafts.map((c) => c.tx)) : await Promise.all(crafts.map((c) => signTransaction(c.tx)));
        const cancelled: string[] = [];
        const failed: string[] = [];
        for (let i = 0; i < crafts.length; i++) {
          const c = crafts[i];
          const done = await fetch(`/api/jupiter/trigger/orders/${c.orderId}/confirm-cancel`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ signedTransaction: versionedTransactionToBase64(signedTxs[i] as VersionedTransaction), cancelRequestId: c.requestId }),
          });
          (done.ok ? cancelled : failed).push(c.id);
        }
        // A leg with no jupiterOrderId yet (failed before an order existed) was never really live: nothing to cancel.
        for (const r of recs) if (!r.jupiterOrderId) failed.push(r.id);
        return { cancelled, failed };
      } catch {
        return { cancelled: [], failed: recs.map((r) => r.id) };
      }
    },
    [ensureJwt, signTransaction, signAllTransactions]
  );

  // ── confirm: sign in, PREPARE every tranche first (server calls only), then ONE signAllTransactions for
  // every deposit + fee together (a single wallet approval, on Phantom and Solflare alike — both support
  // batched signing), then submit each. Jupiter's Trigger API still ties one deposit signature to exactly one
  // order underneath (verified against its own docs — there is no way to fund several orders with one
  // cryptographic signature), so this is one wallet POPUP covering several transactions, not one signature —
  // the closest real thing to "one approval" the API allows. They are drawn and shown as ONE strategy (see the
  // `groupId`-based grouping in `lines` above and `records` below) even though each is independent underneath:
  // a fill on one can never oversell another's share, and the stop always only covers what's still unsold.
  const confirm = useCallback(
    async (view: DraftView) => {
      const d = view.draft;
      if (!view.ready || !coin || !signTransaction) return;
      setError(null);
      const groupId = d.id;
      const legs = d.sells;
      const createdRecords: StrategyRecord[] = [];
      try {
        setStep("session");
        await ensureSession();
        setStep("jupiter");
        const token = await ensureJwt();
        const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
        const totalValue = parseFloat(d.amount);

        // 1) Prepare every tranche's deposit — server calls only, nothing to sign yet.
        setStep("prepare");
        type Prepared = { legId: string; deposit: VersionedTransaction; feeTx: Transaction | null };
        const prepared: Prepared[] = [];
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          const legId = legs.length === 1 ? d.id : `${d.id}-${i}`;
          const legValue = totalValue * (leg.pct / 100);
          const prep = await fetch("/api/strategy/prepare", {
            method: "POST",
            headers,
            body: JSON.stringify({
              id: legId,
              n: d.n,
              mint: coin.mint,
              ticker: coin.ticker,
              buyUsd: d.buy,
              sellUsd: leg.price,
              stopUsd: d.stop,
              amount: { unit: d.unit, value: legValue },
              fundingAsset: view.asset,
              groupId,
              legIndex: i,
              legCount: legs.length,
              legPct: leg.pct,
            }),
          });
          const p = await prep.json();
          if (!prep.ok) throw new ApiError(p.error, p.code, p.issues);
          prepared.push({ legId, deposit: base64ToVersionedTransaction(p.transaction), feeTx: p.feeTransaction ? base64ToTransaction(p.feeTransaction) : null });
        }

        // 2) Sign every deposit + fee together: one wallet popup for the whole batch when the wallet supports
        // it (both Phantom and Solflare do); a wallet that doesn't falls back to one approval per tranche.
        setStep("sign");
        let signed: { deposit: VersionedTransaction; feeTx: Transaction | null }[];
        if (signAllTransactions) {
          const flat: (VersionedTransaction | Transaction)[] = [];
          for (const p of prepared) {
            flat.push(p.deposit);
            if (p.feeTx) flat.push(p.feeTx);
          }
          const signedFlat = await signAllTransactions(flat);
          let cursor = 0;
          signed = prepared.map((p) => ({ deposit: signedFlat[cursor++] as VersionedTransaction, feeTx: p.feeTx ? (signedFlat[cursor++] as Transaction) : null }));
        } else {
          signed = [];
          for (const p of prepared) signed.push({ deposit: await signTransaction(p.deposit), feeTx: p.feeTx ? await signTransaction(p.feeTx) : null });
        }

        // 3) Submit every signed order, in order.
        setStep("create");
        for (let i = 0; i < prepared.length; i++) {
          setLegProgress({ index: i, total: prepared.length });
          const created = await fetch("/api/strategy/create", {
            method: "POST",
            headers,
            body: JSON.stringify({ id: prepared[i].legId, depositSignedTx: versionedTransactionToBase64(signed[i].deposit), feeSignedTx: signed[i].feeTx ? transactionToBase64(signed[i].feeTx!) : undefined }),
          });
          const result = await created.json();
          if (!created.ok) throw new ApiError(result.error, result.code);
          createdRecords.push(result.strategy as StrategyRecord);
        }

        setRecords((rs) => [...rs.filter((r) => r.groupId !== groupId && r.id !== d.id), ...createdRecords]);
        setDrafts((ds) => ds.filter((x) => x.id !== d.id));
        setActiveId(null);
        setLegProgress(null);
        setStep("done");
        setTimeout(() => setStep("idle"), 3500);
      } catch (err) {
        setLegProgress(null);
        if (err instanceof ApiError && err.code === "JUPITER_AUTH_REQUIRED") jwt.current = null;
        // A tranche that failed to SEND after some others already went through: cancel the ones that did,
        // automatically, so nothing partial is left silently open — then say plainly what happened. Cancelling
        // needs its own wallet approval (a real withdrawal from Jupiter's vault), batched the same way if there's
        // more than one to roll back.
        if (createdRecords.length > 0 && createdRecords.length < legs.length) {
          setStep("prepare");
          const { cancelled, failed } = await autoCancelLegs(createdRecords);
          const stillOpen = createdRecords.filter((r) => failed.includes(r.id));
          setRecords((rs) => [...rs.filter((r) => !createdRecords.some((c) => c.id === r.id)), ...stillOpen]);
          setStep("idle");
          const partial = { done: createdRecords.length, total: legs.length, rolledBack: cancelled.length, stillOpen: stillOpen.length };
          setError(err instanceof ApiError ? { message: err.message, code: err.code, issues: err.issues, partial } : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined, partial });
          return;
        }
        setStep("idle");
        // A single-tranche strategy, or one that failed before any tranche was created: nothing to roll back.
        if (createdRecords.length > 0) setRecords((rs) => [...rs.filter((r) => !createdRecords.some((c) => c.id === r.id)), ...createdRecords]);
        setError(err instanceof ApiError ? { message: err.message, code: err.code, issues: err.issues } : { message: err instanceof Error ? err.message : String(err), code: /reject|cancel|denied/i.test(String(err)) ? "REJECTED" : undefined });
      }
    },
    [coin, ensureJwt, ensureSession, signTransaction, signAllTransactions, autoCancelLegs]
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
    legProgress,
    error,
    syncing,
    cancelling,
    engine: quote?.engine ?? false,
    setActiveId,
    patchDraft,
    setPrice,
    setStaggered,
    addSellTranche,
    removeSellTranche,
    setSellPct,
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
