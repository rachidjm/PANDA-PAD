import { randomUUID } from "node:crypto";
import { PublicKey, Transaction, type AccountInfo, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import {
  pgActivate,
  pgGetPrepared,
  pgListOrders,
  pgLiveByNonces,
  pgLiveOrders,
  pgNonceAccounts,
  pgPurgeExpiredPrepared,
  pgReplacePrepared,
  pgSetNonceState,
  pgTransition,
  pgUpsertNonce,
  type PandaOrderInsert,
  type PandaOrderRow,
} from "@/lib/db/panda-orders";
import {
  amountForPct,
  committedRaw,
  feeFor,
  MAX_TRANCHES,
  minOutFor,
  triggerOutFor,
  validateTranches,
  type DrawnTranche,
  type Leg,
  type OrderState,
  type TrancheIssue,
} from "./math";
import { closeInstructions, MAX_NONCE_INDEX, messageHash, nonceAddress, nonceSeed, orderTransaction, PACKET_LIMIT, parseNonce, setupInstructions, verifySignedOrder, type ParsedNonce } from "./tx";
import type { VenueError, VenueState } from "./market";
import type { SealedTx } from "./crypto";

/**
 * The server side of PANDA orders: prepare (validate the drawing, read the chain, hand back what to sign), submit (check
 * every signed byte is what was prepared, then store it encrypted), close (cancel: give the deposit back and invalidate),
 * and list. Every dependency on the outside world comes in through `Deps`, so the rules are tested without a network.
 */

export type Deps = {
  now: () => number;
  db: () => Db;
  newId: () => string;
  quoteUsd: (mint: string) => Promise<{ tokenUsd: number | null; solUsd: number | null }>;
  loadVenue: (mint: PublicKey, user: PublicKey, poolHint?: PublicKey) => Promise<VenueState | VenueError>;
  quoteOut: (v: VenueState, amount: bigint) => bigint;
  saleInstructions: (v: VenueState, user: PublicKey, amount: bigint, minOut: bigint) => Promise<TransactionInstruction[]>;
  /** Raw balance of `mint` in the wallet's associated token account — the account the sale spends from. */
  tokenBalance: (wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => Promise<{ raw: bigint; decimals: number }>;
  accounts: (addresses: PublicKey[]) => Promise<(AccountInfo<Buffer> | null)[]>;
  rentLamports: () => Promise<number>;
  latestBlockhash: () => Promise<string>;
  /** PANDA orders' frozen lookup table (alt.ts), or null: orders are then built without one. */
  lookupTable: () => Promise<AddressLookupTableAccount | null>;
  feeBps: (wallet: string) => Promise<number>;
  feeInstructions: (wallet: PublicKey, feeLamports: bigint) => Promise<TransactionInstruction[]>;
  signatureStatuses: (signatures: string[]) => Promise<({ ok: boolean } | null)[]>;
  hasKey: () => boolean;
  seal: (orderId: string, bytes: Uint8Array) => SealedTx | null;
  audit: (e: { actor: string; action: string; object: string; newState?: unknown; reason?: string }) => Promise<void>;
};

export type Failure = { ok: false; status: number; code: string; message: string; issues?: Record<string, TrancheIssue[]> };
const fail = (status: number, code: string, message: string, issues?: Record<string, TrancheIssue[]>): Failure => ({ ok: false, status, code, message, issues });

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const key = (s: unknown): PublicKey | null => {
  if (typeof s !== "string") return null;
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
};
/** A nonce account handed out in a setup transaction counts as "on its way" for this long (the RPC catching up right
 *  after it confirmed); after that, if it still doesn't exist, it is offered again in the next setup transaction. */
const PENDING_GRACE_MS = 20_000;
/** Nonce accounts created per setup transaction: 5 fit comfortably in 1,232 bytes (tx.test.ts measures it). */
export const SETUP_PER_TX = 5;
const CLOSE_PER_TX = 10;

export type PrepareInput = { wallet: string; mint: unknown; ticker: unknown; groupId: unknown; n: unknown; pool?: unknown; tranches: unknown; riskAccepted: unknown };

export type PreparedOrder = { id: string; trancheId: string; leg: Leg; transaction: string; tokenAmountRaw: string; minOutLamports: number; feeLamports: number };
export type PrepareResult =
  | { ok: true; phase: "setup"; transaction: string; nonceAccounts: string[]; rentLamports: number }
  | { ok: true; phase: "orders"; orders: PreparedOrder[]; venue: "curve" | "amm" };

export async function prepareOrders(deps: Deps, i: PrepareInput): Promise<PrepareResult | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  const wallet = key(i.wallet);
  const mint = key(i.mint);
  if (!wallet || !mint) return fail(400, "invalid", "Invalid wallet or coin address.");
  if (typeof i.groupId !== "string" || !ID_RE.test(i.groupId)) return fail(400, "invalid", "Invalid draft id.");
  if (!Number.isInteger(i.n) || (i.n as number) < 1 || (i.n as number) > 999) return fail(400, "invalid", "Invalid strategy number.");
  const ticker = typeof i.ticker === "string" && /^[\w.$-]{1,16}$/.test(i.ticker) ? i.ticker : "?";
  const pool = i.pool === undefined || i.pool === null ? undefined : key(i.pool) ?? undefined;
  const tranches = (Array.isArray(i.tranches) ? i.tranches : []).map((t) => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const price = (v: unknown) => (v === undefined || v === null ? undefined : typeof v === "number" ? v : NaN);
    return { trancheId: o.trancheId as string, pct: o.pct as number, sellUsd: price(o.sellUsd), stopUsd: price(o.stopUsd) } as DrawnTranche;
  });
  if (tranches.length === 0 || tranches.length > MAX_TRANCHES) return fail(400, "invalid", `Between 1 and ${MAX_TRANCHES} lines per strategy.`);
  // The user must have answered "Sí" to the slippage warning for any stop — the server checks it too.
  if (tranches.some((t) => t.stopUsd !== undefined) && i.riskAccepted !== true) return fail(400, "risk_not_accepted", "Accept the stop warning first.");

  const { tokenUsd } = await deps.quoteUsd(mint.toBase58());
  if (!tokenUsd || !(tokenUsd > 0)) return fail(503, "price_unavailable", "No live price for this coin right now.");
  const checked = validateTranches(tranches, tokenUsd);
  if (typeof checked === "string") return fail(400, checked, "These lines can't be placed as drawn.");
  const issues = Object.fromEntries([...checked.entries()].filter(([, v]) => v.length > 0));
  if (Object.keys(issues).length) return fail(422, "issues", "These lines can't be placed as drawn.", issues);

  const venue = await deps.loadVenue(mint, wallet, pool);
  if (venue === "not_found") return fail(404, "not_found", "That coin wasn't found on-chain.");
  if (venue === "unsupported") return fail(422, "unsupported_coin", "PANDA orders only work on Pump.fun and PumpSwap coins.");

  const db = deps.db();
  const now = deps.now();
  await pgPurgeExpiredPrepared(db, now);
  const balance = await deps.tokenBalance(wallet, mint, venue.tokenProgram);
  // What other live orders on this coin already promised (this draft's own unsigned orders are about to be replaced).
  const otherLive = (await pgLiveOrders(db, wallet.toBase58(), mint.toBase58())).filter((o) => !(o.groupId === i.groupId && o.state === "prepared"));
  const available = balance.raw - committedRaw(otherLive.map((o) => ({ nonceAccount: o.nonceAccount, tokenAmountRaw: o.tokenAmountRaw, state: o.state as OrderState })));
  if (available <= BigInt(0)) return fail(422, "no_balance", "You don't have any of this coin left that isn't already in another order.");

  const feeBps = await deps.feeBps(wallet.toBase58());
  type Plan = { t: DrawnTranche; amount: bigint; legs: { leg: Leg; targetUsd: number; trigger: bigint; minOut: bigint; fee: bigint }[] };
  const plans: Plan[] = [];
  const amountIssues: Record<string, TrancheIssue[]> = {};
  for (const t of tranches) {
    const amount = amountForPct(available, t.pct);
    const current = amount > BigInt(0) ? deps.quoteOut(venue, amount) : BigInt(0);
    const legs: Plan["legs"] = [];
    for (const [leg, target] of [["sell", t.sellUsd], ["stop", t.stopUsd]] as const) {
      if (target === undefined) continue;
      const trigger = triggerOutFor(current, target, tokenUsd);
      const minOut = minOutFor(trigger, leg);
      legs.push({ leg, targetUsd: target, trigger, minOut, fee: feeFor(minOut, feeBps) });
    }
    if (amount <= BigInt(0) || legs.some((l) => l.minOut <= BigInt(0))) amountIssues[t.trancheId] = ["amount_zero"];
    plans.push({ t, amount, legs });
  }
  if (Object.keys(amountIssues).length) return fail(422, "issues", "A line is too small to sell anything.", amountIssues);

  // ── nonce accounts: one per tranche, reusing the wallet's free ones first ──────────────────────────────────────
  const rows = await pgNonceAccounts(db, wallet.toBase58());
  const allLive = await pgLiveOrders(db, wallet.toBase58());
  const inUse = new Set(allLive.filter((o) => !(o.groupId === i.groupId && o.state === "prepared")).map((o) => o.nonceAccount));
  const candidates = rows.filter((r) => r.state !== "closed" && !inUse.has(r.address));
  const infos = candidates.length ? await deps.accounts(candidates.map((r) => new PublicKey(r.address))) : [];
  const usable: ParsedNonce[] = [];
  let pendingRecent = 0;
  // Handed out in a setup transaction that never landed (the user closed the popup…): offered again, same address.
  const stale: { address: PublicKey; seed: string }[] = [];
  for (let k = 0; k < candidates.length; k++) {
    const r = candidates[k];
    const parsed = parseNonce(r.address, infos[k] ?? null);
    if (parsed && parsed.authority === wallet.toBase58()) {
      usable.push(parsed);
      if (r.state !== "ready") await pgSetNonceState(db, r.wallet, r.address, "ready", now);
    } else if (!infos[k] && r.state === "pending") {
      if (now - r.updatedAt < PENDING_GRACE_MS) pendingRecent++;
      else stale.push({ address: new PublicKey(r.address), seed: r.seed });
    } else if (!infos[k]) {
      await pgSetNonceState(db, r.wallet, r.address, "closed", now);
    }
  }
  if (usable.length < plans.length) {
    if (usable.length + pendingRecent >= plans.length) return fail(409, "nonce_pending", "Your order accounts are still being created — try again in a few seconds.");
    const need = Math.min(plans.length - usable.length - pendingRecent, SETUP_PER_TX);
    const taken = new Set(rows.filter((r) => r.state !== "closed").map((r) => r.address));
    const fresh: { address: PublicKey; seed: string }[] = stale.slice(0, need);
    for (let idx = 0; idx < MAX_NONCE_INDEX && fresh.length < need; idx++) {
      const address = await nonceAddress(wallet, idx);
      if (taken.has(address.toBase58())) continue;
      const [onChain] = await deps.accounts([address]);
      if (onChain) continue; // something already lives there (an old account PANDA doesn't track) — skip it
      fresh.push({ address, seed: nonceSeed(idx) });
    }
    if (fresh.length < need) return fail(422, "too_many", "Too many order accounts — cancel or recover some first.");
    const rent = await deps.rentLamports();
    const tx = new Transaction({ feePayer: wallet, recentBlockhash: await deps.latestBlockhash() }).add(...setupInstructions(wallet, fresh, rent));
    for (const f of fresh) await pgUpsertNonce(db, { address: f.address.toBase58(), wallet: wallet.toBase58(), seed: f.seed, state: "pending" }, now);
    return {
      ok: true,
      phase: "setup",
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      nonceAccounts: fresh.map((f) => f.address.toBase58()),
      rentLamports: rent,
    };
  }

  // ── the orders themselves: one transaction per leg, both legs of a tranche on the SAME nonce ────────────────────
  const lookupTable = await deps.lookupTable();
  const out: PreparedOrder[] = [];
  const inserts: PandaOrderInsert[] = [];
  for (let k = 0; k < plans.length; k++) {
    const p = plans[k];
    const nonce = usable[k];
    for (const l of p.legs) {
      const id = deps.newId();
      const sale = await deps.saleInstructions(venue, wallet, p.amount, l.minOut);
      const fee = await deps.feeInstructions(wallet, l.fee);
      const tx = orderTransaction({ wallet, nonceAccount: new PublicKey(nonce.address), nonceValue: nonce.nonce, sale, fee, lookupTable });
      const bytes = tx.serialize();
      if (bytes.length > PACKET_LIMIT) return fail(422, "too_large", "This order doesn't fit in one Solana transaction.");
      out.push({ id, trancheId: p.t.trancheId, leg: l.leg, transaction: Buffer.from(bytes).toString("base64"), tokenAmountRaw: p.amount.toString(), minOutLamports: Number(l.minOut), feeLamports: Number(l.fee) });
      inserts.push({
        id,
        wallet: wallet.toBase58(),
        mint: mint.toBase58(),
        ticker,
        groupId: i.groupId,
        trancheId: p.t.trancheId,
        n: i.n as number,
        leg: l.leg,
        venue: venue.venue,
        pool: venue.venue === "amm" ? venue.pool.toBase58() : null,
        pct: p.t.pct,
        nonceAccount: nonce.address,
        nonceValue: nonce.nonce,
        tokenAmountRaw: p.amount.toString(),
        tokenDecimals: balance.decimals,
        triggerOutLamports: Number(l.trigger),
        minOutLamports: Number(l.minOut),
        feeLamports: Number(l.fee),
        targetUsd: l.targetUsd,
        refUsd: tokenUsd,
        state: "prepared",
        messageHash: messageHash(tx.message.serialize()),
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await pgReplacePrepared(db, wallet.toBase58(), i.groupId, inserts, now);
  return { ok: true, phase: "orders", orders: out, venue: venue.venue };
}

export type SubmitInput = { wallet: string; groupId: unknown; signed: unknown };

/** All the group's prepared orders, signed — checked byte for byte — or nothing is stored. */
export async function submitOrders(deps: Deps, i: SubmitInput): Promise<{ ok: true; orders: PublicOrder[] } | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  if (typeof i.groupId !== "string" || !ID_RE.test(i.groupId)) return fail(400, "invalid", "Invalid draft id.");
  const signed = (Array.isArray(i.signed) ? i.signed : []) as { id?: unknown; transaction?: unknown }[];
  if (signed.length === 0 || signed.length > MAX_TRANCHES * 2) return fail(400, "invalid", "Nothing to submit.");
  const db = deps.db();
  const now = deps.now();
  const ids = signed.map((s) => (typeof s.id === "string" ? s.id : ""));
  const prepared = await pgGetPrepared(db, i.wallet, ids, now);
  const groupPrepared = (await pgListOrders(db, i.wallet)).filter((o) => o.groupId === i.groupId && o.state === "prepared");
  if (prepared.length !== signed.length || prepared.some((p) => p.groupId !== i.groupId) || groupPrepared.length !== signed.length) {
    return fail(409, "expired", "Those orders expired or changed — prepare them again.");
  }
  const items: { id: string; txCiphertext: string; txIv: string; signature: string }[] = [];
  for (const s of signed) {
    const row = prepared.find((p) => p.id === s.id)!;
    const v = verifySignedOrder(s.transaction, { wallet: i.wallet, messageHash: row.messageHash });
    if (!v.ok) {
      return fail(400, v.reason === "modified" ? "wallet_modified" : "invalid_signature", v.reason === "modified" ? "Your wallet changed the transaction before signing it, so it can't be stored. Nothing was saved." : "The signature doesn't match.");
    }
    const sealed = deps.seal(row.id, v.bytes);
    if (!sealed) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
    items.push({ id: row.id, txCiphertext: sealed.ciphertext, txIv: sealed.iv, signature: v.signature });
  }
  if (!(await pgActivate(db, i.wallet, items, now))) return fail(409, "expired", "Those orders expired or changed — prepare them again.");
  await deps.audit({ actor: i.wallet, action: "panda_orders.submit", object: i.groupId, newState: { orders: items.map((x) => x.id) } });
  const orders = (await pgListOrders(db, i.wallet)).filter((o) => o.groupId === i.groupId && o.state === "active");
  return { ok: true, orders: orders.map(publicOrder) };
}

export type CloseInput = { wallet: string; groupId?: unknown; trancheId?: unknown; recover?: unknown };

/** The transaction that closes nonce accounts (deposit back to the wallet): those of a group / one tranche (= cancel
 *  those orders), or every FREE one (`recover`: deposits of orders already executed or cancelled). The user signs it. */
export async function closeNonces(deps: Deps, i: CloseInput): Promise<{ ok: true; transaction: string; nonceAccounts: string[]; lamports: number } | Failure> {
  const wallet = key(i.wallet);
  if (!wallet) return fail(400, "invalid", "Invalid wallet.");
  const db = deps.db();
  const live = await pgLiveOrders(db, i.wallet);
  let targets: string[];
  if (i.recover === true) {
    const inUse = new Set(live.map((o) => o.nonceAccount));
    targets = (await pgNonceAccounts(db, i.wallet)).filter((r) => r.state !== "closed" && !inUse.has(r.address)).map((r) => r.address);
  } else {
    if (typeof i.groupId !== "string" || !ID_RE.test(i.groupId)) return fail(400, "invalid", "Invalid strategy.");
    targets = [...new Set(live.filter((o) => o.groupId === i.groupId && (i.trancheId === undefined || o.trancheId === i.trancheId)).map((o) => o.nonceAccount))];
  }
  targets = targets.slice(0, CLOSE_PER_TX);
  if (targets.length === 0) return fail(404, "nothing", "Nothing to close.");
  const infos = await deps.accounts(targets.map((t) => new PublicKey(t)));
  const closable = targets.map((t, k) => parseNonce(t, infos[k] ?? null)).filter((p): p is ParsedNonce => !!p && p.authority === i.wallet);
  if (closable.length === 0) {
    await markClosed(deps, i.wallet, targets);
    return fail(404, "nothing", "Those accounts are already closed.");
  }
  const tx = new Transaction({ feePayer: wallet, recentBlockhash: await deps.latestBlockhash() }).add(...closeInstructions(wallet, closable.map((c) => ({ address: new PublicKey(c.address), lamports: c.lamports }))));
  return {
    ok: true,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    nonceAccounts: closable.map((c) => c.address),
    lamports: closable.reduce((s, c) => s + c.lamports, 0),
  };
}

/** After the user's close landed: every account that is really gone is marked closed, and its live orders end — as
 *  EXECUTED if their own transaction landed first (a race with the watcher), otherwise cancelled. Nothing is trusted
 *  from the browser: only what the chain shows. */
export async function confirmClosed(deps: Deps, i: { wallet: string; nonceAccounts: unknown }): Promise<{ ok: true; closed: string[] } | Failure> {
  const list = (Array.isArray(i.nonceAccounts) ? i.nonceAccounts : []).filter((a): a is string => typeof a === "string" && !!key(a)).slice(0, CLOSE_PER_TX);
  if (list.length === 0) return fail(400, "invalid", "Nothing to confirm.");
  const infos = await deps.accounts(list.map((a) => new PublicKey(a)));
  const gone = list.filter((_, k) => !infos[k]);
  await markClosed(deps, i.wallet, gone);
  return { ok: true, closed: gone };
}

async function markClosed(deps: Deps, wallet: string, addresses: string[]): Promise<void> {
  if (addresses.length === 0) return;
  const db = deps.db();
  const now = deps.now();
  const tracked = new Set((await pgNonceAccounts(db, wallet)).map((r) => r.address));
  for (const a of addresses) if (tracked.has(a)) await pgSetNonceState(db, wallet, a, "closed", now);
  const live = await pgLiveByNonces(db, wallet, addresses);
  const sigs = live.map((o) => o.signature).filter((s): s is string => !!s);
  const statuses = sigs.length ? await deps.signatureStatuses(sigs) : [];
  const landed = new Set(sigs.filter((_, k) => statuses[k]?.ok));
  for (const o of live) {
    if (o.signature && landed.has(o.signature)) await pgTransition(db, o.id, ["active", "sending"], { state: "executed", executedAt: now, notice: "executed", noticeAt: now }, now);
    else await pgTransition(db, o.id, ["prepared", "active", "sending"], { state: "cancelled", reason: "user_cancelled" }, now);
  }
  await deps.audit({ actor: wallet, action: "panda_orders.close", object: addresses.join(","), newState: { orders: live.map((o) => o.id) } });
}

/** What the browser may see of an order: never the signed bytes (encrypted or not) nor the message hash. */
export type PublicOrder = Omit<PandaOrderRow, "txCiphertext" | "txIv" | "messageHash">;
export function publicOrder(o: PandaOrderRow): PublicOrder {
  const rest: Partial<PandaOrderRow> = { ...o };
  delete rest.txCiphertext;
  delete rest.txIv;
  delete rest.messageHash;
  return rest as PublicOrder;
}

export async function listOrders(
  deps: Deps,
  i: { wallet: string; mint?: string }
): Promise<{ orders: PublicOrder[]; committedRaw: string | null; freeNonces: string[]; rentLamports: number }> {
  const db = deps.db();
  const now = deps.now();
  await pgPurgeExpiredPrepared(db, now);
  const orders = await pgListOrders(db, i.wallet, i.mint);
  const live = await pgLiveOrders(db, i.wallet);
  const inUse = new Set(live.map((o) => o.nonceAccount));
  const freeNonces = (await pgNonceAccounts(db, i.wallet)).filter((r) => r.state === "ready" && !inUse.has(r.address)).map((r) => r.address);
  const committed = i.mint ? committedRaw(live.filter((o) => o.mint === i.mint && o.state !== "prepared").map((o) => ({ nonceAccount: o.nonceAccount, tokenAmountRaw: o.tokenAmountRaw, state: o.state as OrderState }))) : null;
  return {
    orders: orders.filter((o) => o.state !== "prepared").map(publicOrder),
    committedRaw: committed === null ? null : committed.toString(),
    freeNonces,
    rentLamports: freeNonces.length ? await deps.rentLamports() : 0,
  };
}

export const newOrderId = () => randomUUID();
