import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { pgTransition, pgWatchList, type PandaOrderRow } from "@/lib/db/panda-orders";
import { classifyFailure, isTriggered, stateAfterFailure, type FailureKind, type Leg, type OrderState } from "./math";
import { parseNonce } from "./tx";
import type { VenueError, VenueState } from "./market";
import type { SealedTx } from "./crypto";

/**
 * The PANDA order watcher, run by the per-minute cron for ~50 s. It only ever does three things with an order: read
 * the live quote for its exact amount, SIMULATE the user's own signed bytes, and — only if the level is reached and the
 * simulation passes — SEND those same bytes. It can't change a single byte (the user's signature covers all of them),
 * so it can't change the amount, the minimum, the fee or where the money goes. If the market can't pay what the user
 * signed, the transaction fails and nothing is sold.
 *
 * Re-sending the same bytes is harmless (same signature: the chain processes it once), and a sell and a stop of one
 * tranche share a nonce (only one can ever land) — so two overlapping runs can't double-sell.
 */

export type WatchDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  db: () => Db;
  loadVenue: (mint: PublicKey, user: PublicKey, poolHint?: PublicKey) => Promise<VenueState | VenueError>;
  priceAccounts: (v: VenueState) => PublicKey[];
  refreshVenue: (v: VenueState, infos: (AccountInfo<Buffer> | null)[]) => VenueState | "migrated" | null;
  quoteOut: (v: VenueState, amount: bigint) => bigint;
  accounts: (addresses: PublicKey[]) => Promise<(AccountInfo<Buffer> | null)[]>;
  open: (orderId: string, sealed: SealedTx) => Uint8Array | null;
  simulate: (bytes: Uint8Array) => Promise<{ err: unknown; logs: string[] | null }>;
  send: (bytes: Uint8Array) => Promise<void>;
  /** Per signature: null = not seen yet; ok=false = landed and FAILED (the nonce moved anyway). */
  statuses: (signatures: string[]) => Promise<({ ok: boolean } | null)[]>;
  audit: (e: { actor: string; action: string; object: string; newState?: unknown; reason?: string }) => Promise<void>;
  alert: (message: string, detail?: Record<string, unknown>) => Promise<void>;
};

export type WatchReport = { orders: number; ticks: number; sent: number; executed: number; invalidated: number; notices: number; errors: string[] };

const TICK_MS = 1_500;
/** How often an order that hasn't triggered is simulated anyway, to catch a migration / program change / missing tokens early. */
const HEALTH_EVERY_MS = 10 * 60_000;
/** A notice of the same kind isn't repeated more often than this (a stop that keeps failing on slippage, no SOL…). */
const NOTICE_EVERY_MS = 30 * 60_000;
/** A sent transaction with no status after this long is treated as dropped: back to "active", sent again when due. */
const DROPPED_AFTER_MS = 90_000;

export async function runWatcher(deps: WatchDeps, budgetMs: number): Promise<WatchReport> {
  const started = deps.now();
  const db = deps.db();
  const report: WatchReport = { orders: 0, ticks: 0, sent: 0, executed: 0, invalidated: 0, notices: 0, errors: [] };
  let orders = await pgWatchList(db);
  report.orders = orders.length;
  if (orders.length === 0) return report;

  const set = async (o: PandaOrderRow, from: OrderState[], patch: Parameters<typeof pgTransition>[3]) => {
    const row = await pgTransition(db, o.id, from, patch, deps.now());
    if (row) orders = orders.map((x) => (x.id === row.id ? row : x));
    return row;
  };
  const notice = async (o: PandaOrderRow, kind: string) => {
    const now = deps.now();
    if (o.notice === kind && o.noticeAt && now - o.noticeAt < NOTICE_EVERY_MS) return;
    if (await set(o, [o.state as OrderState], { notice: kind, noticeAt: now })) report.notices++;
  };

  // 1. The nonce of every order: moved on or gone = one leg landed, or the user cancelled outside PANDA.
  await reconcileNonces(deps, orders, set, report);
  orders = orders.filter((o) => o.state === "active" || o.state === "sending");

  // 2. One venue per coin (read once per run), refreshed every tick from a single getMultipleAccounts.
  const venues = new Map<string, VenueState>();
  for (const mint of [...new Set(orders.map((o) => o.mint))]) {
    const first = orders.find((o) => o.mint === mint)!;
    try {
      const v = await deps.loadVenue(new PublicKey(mint), new PublicKey(first.wallet), first.pool ? new PublicKey(first.pool) : undefined);
      if (typeof v === "string") continue;
      // A curve order on a coin that has graduated can never work again: the user has to re-sign it for PumpSwap.
      for (const o of orders.filter((x) => x.mint === mint && x.state === "active" && x.venue !== v.venue)) {
        if (await set(o, ["active"], { state: "needs_resign", reason: "migrated", notice: "needs_resign", noticeAt: deps.now() })) report.invalidated++;
      }
      venues.set(mint, v);
    } catch (err) {
      report.errors.push(`venue ${mint}: ${String(err).slice(0, 120)}`);
    }
  }

  while (deps.now() - started < budgetMs) {
    report.ticks++;
    // Fresh reserves for every coin in one call.
    const list = [...venues.entries()];
    const keys = list.flatMap(([, v]) => deps.priceAccounts(v));
    let infos: (AccountInfo<Buffer> | null)[] = [];
    try {
      infos = keys.length ? await deps.accounts(keys) : [];
    } catch (err) {
      report.errors.push(`accounts: ${String(err).slice(0, 120)}`);
      await deps.sleep(TICK_MS);
      continue;
    }
    let cursor = 0;
    for (const [mint, v] of list) {
      const n = deps.priceAccounts(v).length;
      const fresh = deps.refreshVenue(v, infos.slice(cursor, cursor + n));
      cursor += n;
      if (fresh === "migrated") {
        venues.delete(mint);
        for (const o of orders.filter((x) => x.mint === mint && x.state === "active" && x.venue === "curve")) {
          if (await set(o, ["active"], { state: "needs_resign", reason: "migrated", notice: "needs_resign", noticeAt: deps.now() })) report.invalidated++;
        }
      } else if (fresh) venues.set(mint, fresh);
    }

    for (const o of [...orders]) {
      if (deps.now() - started >= budgetMs) break;
      const v = venues.get(o.mint);
      if (o.state === "sending") {
        await followUp(deps, o, set, report);
        // Its twin (the other leg of the same tranche, same nonce) can never land now: over, as an OCO.
        if (orders.find((x) => x.id === o.id)?.state === "executed") {
          for (const twin of orders.filter((x) => x.nonceAccount === o.nonceAccount && x.id !== o.id && (x.state === "active" || x.state === "sending"))) {
            await set(twin, ["active", "sending"], { state: "cancelled", reason: "oco" });
          }
        }
        continue;
      }
      if (o.state !== "active" || !v) continue;
      const live = deps.quoteOut(v, BigInt(o.tokenAmountRaw));
      const due = isTriggered(o.leg as Leg, live, BigInt(o.triggerOutLamports));
      const healthDue = !o.lastCheckedAt || deps.now() - o.lastCheckedAt > HEALTH_EVERY_MS;
      if (!due && !healthDue) continue;
      await attempt(deps, o, due, set, notice, report);
    }
    orders = orders.filter((o) => o.state === "active" || o.state === "sending");
    if (orders.length === 0) break;
    await deps.sleep(TICK_MS);
  }
  return report;
}

type Setter = (o: PandaOrderRow, from: OrderState[], patch: Parameters<typeof pgTransition>[3]) => Promise<PandaOrderRow | null>;

/** Simulates the user's signed bytes; sends them if the level is reached (`due`) and the simulation passes. A health
 *  check (`due` false) never sends — it only learns whether the order can still work. */
async function attempt(deps: WatchDeps, o: PandaOrderRow, due: boolean, set: Setter, notice: (o: PandaOrderRow, kind: string) => Promise<void>, report: WatchReport) {
  if (!o.txCiphertext || !o.txIv) return;
  const bytes = deps.open(o.id, { ciphertext: o.txCiphertext, iv: o.txIv });
  if (!bytes) {
    report.errors.push(`decrypt ${o.id}`);
    await deps.alert("PANDA orders: a signed order can't be decrypted (PANDA_ORDERS_KEY changed or missing?)", { order: o.id });
    return;
  }
  let sim: { err: unknown; logs: string[] | null };
  try {
    sim = await deps.simulate(bytes);
  } catch (err) {
    report.errors.push(`simulate ${o.id}: ${String(err).slice(0, 120)}`);
    return; // an RPC hiccup says nothing about the order: tried again next tick
  }
  const now = deps.now();
  if (!sim.err) {
    if (!due) {
      await set(o, ["active"], { lastCheckedAt: now, unknownFailures: 0 });
      return;
    }
    const claimed = await set(o, ["active"], { state: "sending", sentAt: now, lastCheckedAt: now, unknownFailures: 0 });
    if (!claimed) return; // another run took it
    try {
      await deps.send(bytes);
      report.sent++;
    } catch (err) {
      report.errors.push(`send ${o.id}: ${String(err).slice(0, 120)}`);
    }
    return;
  }
  const kind: FailureKind = classifyFailure(sim.err, sim.logs);
  // A take-profit that isn't reached simply can't pay its minimum yet — that's the normal state, not a problem.
  if (kind === "slippage" && !due) {
    await set(o, ["active"], { lastCheckedAt: now, unknownFailures: 0 });
    return;
  }
  // An unexplained failure only counts toward invalidating the order when it was due: a background health check that
  // can't be explained (an RPC answering without logs…) must never be what retires a good order.
  if (kind === "unknown" && !due) {
    await set(o, ["active"], { lastCheckedAt: now });
    return;
  }
  const unknownFailures = kind === "unknown" ? o.unknownFailures + 1 : 0;
  const next = stateAfterFailure(kind, unknownFailures);
  if (next) {
    if (await set(o, ["active"], { state: next.state, reason: next.reason, notice: next.state === "needs_resign" ? "needs_resign" : "cancelled", noticeAt: now, lastCheckedAt: now, unknownFailures })) report.invalidated++;
    return;
  }
  await set(o, ["active"], { lastCheckedAt: now, unknownFailures });
  if (kind === "slippage" && o.leg === "stop") await notice(o, "stop_slippage");
  else if (kind === "no_sol") await notice(o, "no_sol");
}

/** A sent order: executed when its signature lands OK (and its twin leg ends: same nonce), re-sent while pending, back to
 *  active if it was dropped, and failed-on-chain → re-sign (the nonce moved, so these bytes can never land again). */
async function followUp(deps: WatchDeps, o: PandaOrderRow, set: Setter, report: WatchReport) {
  if (!o.signature) return;
  let status: { ok: boolean } | null;
  try {
    [status] = await deps.statuses([o.signature]);
  } catch {
    return;
  }
  const now = deps.now();
  if (status?.ok) {
    if (await set(o, ["sending", "active"], { state: "executed", executedAt: now, notice: "executed", noticeAt: now })) {
      report.executed++;
      await deps.audit({ actor: "system:cron", action: "panda_orders.executed", object: o.id, newState: { signature: o.signature, mint: o.mint, leg: o.leg } });
    }
    return;
  }
  if (status && !status.ok) {
    if (await set(o, ["sending"], { state: "needs_resign", reason: "failed_onchain", notice: "needs_resign", noticeAt: now })) report.invalidated++;
    return;
  }
  if (o.sentAt && now - o.sentAt > DROPPED_AFTER_MS) {
    await set(o, ["sending"], { state: "active" });
    return;
  }
  if (o.txCiphertext && o.txIv) {
    const bytes = deps.open(o.id, { ciphertext: o.txCiphertext, iv: o.txIv });
    if (bytes) await deps.send(bytes).catch(() => {});
  }
}

/** Orders whose nonce account no longer holds the nonce they were signed with: if one of the tranche's legs landed, it
 *  is executed and the other leg is over (OCO); if none did, the user moved the nonce (cancelled outside PANDA). */
async function reconcileNonces(deps: WatchDeps, orders: PandaOrderRow[], set: Setter, report: WatchReport) {
  const nonces = [...new Set(orders.map((o) => o.nonceAccount))];
  let infos: (AccountInfo<Buffer> | null)[];
  try {
    infos = await deps.accounts(nonces.map((n) => new PublicKey(n)));
  } catch (err) {
    report.errors.push(`nonces: ${String(err).slice(0, 120)}`);
    return;
  }
  const now = deps.now();
  for (let k = 0; k < nonces.length; k++) {
    const parsed = parseNonce(nonces[k], infos[k] ?? null);
    const group = orders.filter((o) => o.nonceAccount === nonces[k]);
    const moved = group.filter((o) => !parsed || parsed.nonce !== o.nonceValue);
    if (moved.length === 0) continue;
    const sigs = moved.map((o) => o.signature).filter((s): s is string => !!s);
    let statuses: ({ ok: boolean } | null)[] = [];
    try {
      statuses = sigs.length ? await deps.statuses(sigs) : [];
    } catch {
      continue;
    }
    const landed = moved.find((o) => o.signature && statuses[sigs.indexOf(o.signature)]?.ok);
    for (const o of moved) {
      if (landed && o.id === landed.id) {
        if (await set(o, ["active", "sending"], { state: "executed", executedAt: now, notice: "executed", noticeAt: now })) {
          report.executed++;
          await deps.audit({ actor: "system:cron", action: "panda_orders.executed", object: o.id, newState: { signature: o.signature, mint: o.mint, leg: o.leg } });
        }
      } else {
        await set(o, ["active", "sending"], { state: "cancelled", reason: landed ? "oco" : "nonce_used" });
      }
    }
  }
}
