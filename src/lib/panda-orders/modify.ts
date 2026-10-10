import { PublicKey } from "@solana/web3.js";
import { pgLiveOrders, pgListOrders, pgReplaceActive, type PandaOrderInsert } from "@/lib/db/panda-orders";
import { committedRaw, feeFor, minOutFor, triggerOutFor, validateTranches, type Leg, type OrderState, type TrancheIssue } from "./math";
import { advanceTransaction, messageHash, orderTransaction, PACKET_LIMIT, parseNonce, verifySignedOrder } from "./tx";
import { fail, ID_RE, key, pickNonces, publicOrder, requiredLamports, simulateOrFail, solCheck, type Deps, type Failure, type PrepareResult, type PublicOrder } from "./service";

/**
 * Changing a live order (its price, its tranche's %) or cancelling ONE line of a tranche that has two — with ONE wallet
 * approval, no new deposit, and the old order voided FOR REAL, on chain.
 *
 * The wallet keeps one spare order account (the reserve, created with the first deposit — service.ts). In a single batch
 * the user signs:
 *   1. a transaction that only ADVANCES the old account's nonce: once it lands, every order ever signed on that nonce
 *      (the old line and its pair) can never execute — whoever holds a copy of it;
 *   2. the tranche's orders as they should be now (the changed line, and the pair that stays), on the RESERVE account.
 * PANDA sends (1) and only when the chain confirms it does it swap the orders in its database. The old account, with its
 * new nonce, becomes the reserve. If (1) doesn't confirm, nothing is treated as changed or cancelled.
 *
 * Nothing is stored between "prepare" and "submit": what was prepared travels as a ticket sealed with PANDA's orders key
 * (AES-GCM, bound to the wallet and the tranche), so the browser can't change one figure of it.
 */

export const MODIFY_TTL_MS = 10 * 60_000;
/** How long one submit call waits for the nonce advance to confirm before answering "not yet" (the browser asks again). */
export const ADVANCE_POLLS = 8;
export const ADVANCE_POLL_MS = 2_000;
const ADVANCE_FEE_LAMPORTS = 5_000;

export type ModifyInput = { wallet: string; groupId: unknown; trancheId: unknown; sellUsd?: unknown; stopUsd?: unknown; pct?: unknown; drop?: unknown; riskAccepted: unknown; setupSignature?: unknown };
export type ModifyPrepared = {
  ok: true;
  phase: "orders";
  /** The transaction that voids the old orders on chain (advance the old account's nonce). Signed with the rest, sent by PANDA. */
  advance: string;
  orders: { id: string; leg: Leg; transaction: string }[];
  ticket: { ciphertext: string; iv: string };
};

type Ticket = {
  wallet: string;
  groupId: string;
  trancheId: string;
  /** The live orders this replaces — all of the tranche's. */
  replaces: string[];
  rows: PandaOrderInsert[];
  old: { account: string; nonce: string };
  reserve: { account: string; nonce: string };
  advanceHash: string;
  expiresAt: number;
};
const ticketAad = (wallet: string, groupId: string, trancheId: string) => `modify:${wallet}:${groupId}:${trancheId}`;
const price = (v: unknown): number | undefined | null => (v === undefined || v === null ? undefined : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export async function prepareModify(deps: Deps, i: ModifyInput): Promise<ModifyPrepared | Extract<PrepareResult, { phase: "setup" }> | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  const wallet = key(i.wallet);
  if (!wallet) return fail(400, "invalid", "Invalid wallet.");
  if (typeof i.groupId !== "string" || !ID_RE.test(i.groupId) || typeof i.trancheId !== "string") return fail(400, "invalid", "Invalid order.");
  const sellIn = price(i.sellUsd);
  const stopIn = price(i.stopUsd);
  if (sellIn === null || stopIn === null) return fail(400, "invalid", "Invalid price.");
  if (i.pct !== undefined && !(typeof i.pct === "number" && i.pct > 0 && i.pct <= 100)) return fail(400, "invalid", "Invalid percentage.");
  if (i.drop !== undefined && i.drop !== "sell" && i.drop !== "stop") return fail(400, "invalid", "Invalid line.");
  const drop = i.drop as Leg | undefined;

  const db = deps.db();
  const now = deps.now();
  const live = await pgLiveOrders(db, i.wallet);
  const legs = live.filter((o) => o.groupId === i.groupId && o.trancheId === i.trancheId && o.state !== "prepared");
  if (legs.length === 0) return fail(404, "nothing", "That order is no longer active.");
  if (legs.some((o) => o.state !== "active")) return fail(409, "busy", "That order is being executed right now.");
  const sell = legs.find((o) => o.leg === "sell");
  const stop = legs.find((o) => o.leg === "stop");
  const first = legs[0];
  if ((sellIn !== undefined && !sell) || (stopIn !== undefined && !stop)) return fail(400, "invalid", "That order has no such line.");
  if (drop && !legs.some((o) => o.leg === drop)) return fail(400, "invalid", "That order has no such line.");
  // The last line of a tranche is cancelled by closing its account (that also returns the deposit) — closeNonces.
  if (drop && legs.length < 2) return fail(409, "last_leg", "This is the only line of its order: cancel the order instead.");

  const pct = (i.pct as number | undefined) ?? first.pct;
  const pctChanged = pct !== first.pct;
  const target: Record<Leg, number | undefined> = { sell: drop === "sell" ? undefined : sellIn ?? sell?.targetUsd, stop: drop === "stop" ? undefined : stopIn ?? stop?.targetUsd };
  const kept = legs.filter((o) => o.leg !== drop);
  const changed = kept.filter((o) => pctChanged || target[o.leg as Leg] !== o.targetUsd);
  if (!drop && changed.length === 0) return fail(400, "no_change", "Nothing changed.");
  // The same warning as when a stop is first signed — asked again only when the stop itself changes.
  if (changed.some((o) => o.leg === "stop") && i.riskAccepted !== true) return fail(400, "risk_not_accepted", "Accept the stop warning first.");

  const mint = new PublicKey(first.mint);
  const { tokenUsd } = await deps.quoteUsd(first.mint);
  if (!tokenUsd || !(tokenUsd > 0)) return fail(503, "price_unavailable", "No live price for this coin right now.");
  // Only what the user CHANGED has to obey "sell above / stop below the price right now": a line that simply stays is
  // re-signed as it was (the market may have moved towards it since — that is what an order waiting looks like).
  const judged = { trancheId: first.trancheId, pct, sellUsd: changed.some((o) => o.leg === "sell") ? target.sell : undefined, stopUsd: changed.some((o) => o.leg === "stop") ? target.stop : undefined };
  if (judged.sellUsd !== undefined || judged.stopUsd !== undefined) {
    const checked = validateTranches([judged], tokenUsd);
    if (typeof checked === "string") return fail(400, checked, "This line can't be placed there.");
    const issues = Object.fromEntries([...checked.entries()].filter(([, v]) => v.length > 0)) as Record<string, TrancheIssue[]>;
    if (Object.keys(issues).length) return fail(422, "issues", "This line can't be placed there.", issues);
  }
  if (target.sell !== undefined && target.stop !== undefined && target.sell <= target.stop) return fail(422, "issues", "This line can't be placed there.", { [first.trancheId]: ["tp_not_above_stop"] });

  const venue = await deps.loadVenue(mint, wallet, first.pool ? new PublicKey(first.pool) : undefined);
  if (venue === "not_found") return fail(404, "not_found", "That coin wasn't found on-chain.");
  if (venue === "unsupported" || venue.venue !== first.venue) return fail(422, "unsupported_coin", "This coin changed market: cancel the order and place it again.");

  // The old account must still hold exactly the nonce the live legs were signed on (otherwise they are already dead).
  const [info] = await deps.accounts([new PublicKey(first.nonceAccount)]);
  const oldNonce = parseNonce(first.nonceAccount, info ?? null);
  if (!oldNonce || oldNonce.authority !== i.wallet || oldNonce.nonce !== first.nonceValue) return fail(409, "nonce_used", "That order is no longer active.");

  // A new % scales the amount the tranche was signed for; it must still fit in what no OTHER order has promised.
  const oldAmount = BigInt(first.tokenAmountRaw);
  const amount = pctChanged ? (oldAmount * BigInt(Math.round(pct * 100))) / BigInt(Math.round(first.pct * 100)) : oldAmount;
  if (amount <= BigInt(0)) return fail(422, "issues", "This line is too small to sell anything.", { [first.trancheId]: ["amount_zero"] });
  const balance = await deps.tokenBalance(wallet, mint, venue.tokenProgram);
  const others = live.filter((o) => o.mint === first.mint && o.nonceAccount !== first.nonceAccount && o.state !== "prepared");
  const free = balance.raw - committedRaw(others.map((o) => ({ nonceAccount: o.nonceAccount, tokenAmountRaw: o.tokenAmountRaw, state: o.state as OrderState })));
  if (amount > free) return fail(422, "no_balance", "You don't have that much of this coin free of other orders.");

  // The reserve: a free order account of this wallet. A wallet from before reserves existed creates it now (one deposit).
  const picked = await pickNonces(deps, { wallet, need: 1, tranches: 1, setupSignature: i.setupSignature });
  if (!("usable" in picked)) return picked;
  const reserve = picked.usable[0];

  const short = await solCheck(deps, wallet, requiredLamports(0, 1, 0) + ADVANCE_FEE_LAMPORTS);
  if (short) return short;

  // 1. the transaction that voids the old orders.
  const advance = advanceTransaction({ wallet, nonceAccount: new PublicKey(first.nonceAccount), nonceValue: first.nonceValue });
  const advanceBad = await simulateOrFail(deps, advance.serialize(), "stop");
  if (advanceBad) return advanceBad.code === "nonce_pending" ? fail(409, "nonce_used", "That order is no longer active.") : advanceBad;

  // 2. the tranche as it should be now, on the reserve.
  const feeBps = await deps.feeBps(i.wallet);
  const lookupTable = await deps.lookupTable();
  const current = deps.quoteOut(venue, amount);
  const orders: ModifyPrepared["orders"] = [];
  const rows: PandaOrderInsert[] = [];
  for (const old of kept) {
    const leg = old.leg as Leg;
    const moved = changed.includes(old);
    const targetUsd = target[leg]!;
    // A line that stays keeps the minimum it was signed for; a changed one is priced from the market now.
    const trigger = moved ? triggerOutFor(current, targetUsd, tokenUsd) : BigInt(old.triggerOutLamports);
    const minOut = moved ? minOutFor(trigger, leg) : BigInt(old.minOutLamports);
    if (minOut <= BigInt(0)) return fail(422, "issues", "This line is too small to sell anything.", { [first.trancheId]: ["amount_zero"] });
    const fee = moved ? feeFor(minOut, feeBps) : BigInt(old.feeLamports);
    const tx = orderTransaction({
      wallet,
      nonceAccount: new PublicKey(reserve.address),
      nonceValue: reserve.nonce,
      sale: await deps.saleInstructions(venue, wallet, amount, minOut),
      fee: await deps.feeInstructions(wallet, fee),
      lookupTable,
    });
    const bytes = tx.serialize();
    if (bytes.length > PACKET_LIMIT) return fail(422, "too_large", "This order doesn't fit in one Solana transaction.");
    const bad = await simulateOrFail(deps, bytes, leg);
    if (bad) return bad;
    const id = deps.newId();
    orders.push({ id, leg, transaction: Buffer.from(bytes).toString("base64") });
    rows.push({
      id,
      wallet: i.wallet,
      mint: first.mint,
      ticker: first.ticker,
      groupId: first.groupId,
      trancheId: first.trancheId,
      n: first.n,
      leg,
      venue: first.venue,
      pool: first.pool,
      pct,
      nonceAccount: reserve.address,
      nonceValue: reserve.nonce,
      tokenAmountRaw: amount.toString(),
      tokenDecimals: first.tokenDecimals,
      triggerOutLamports: Number(trigger),
      minOutLamports: Number(minOut),
      feeLamports: Number(fee),
      targetUsd,
      refUsd: moved ? tokenUsd : old.refUsd,
      state: "active",
      messageHash: messageHash(tx.message.serialize()),
      createdAt: old.createdAt, // it keeps its place in the list: it is the same order, changed
      updatedAt: now,
    });
  }
  const ticket: Ticket = {
    wallet: i.wallet,
    groupId: first.groupId,
    trancheId: first.trancheId,
    replaces: legs.map((o) => o.id),
    rows,
    old: { account: first.nonceAccount, nonce: first.nonceValue },
    reserve: { account: reserve.address, nonce: reserve.nonce },
    advanceHash: messageHash(advance.message.serialize()),
    expiresAt: now + MODIFY_TTL_MS,
  };
  const sealed = deps.seal(ticketAad(i.wallet, first.groupId, first.trancheId), new TextEncoder().encode(JSON.stringify(ticket)));
  if (!sealed) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  return { ok: true, phase: "orders", advance: Buffer.from(advance.serialize()).toString("base64"), orders, ticket: sealed };
}

export type ModifySubmit = { wallet: string; groupId: unknown; trancheId: unknown; ticket: unknown; advance: unknown; signed: unknown };

/**
 * Everything signed in one batch comes back here. Each piece is checked byte for byte against the sealed ticket; then the
 * nonce advance is sent, and ONLY when the chain confirms it do the new orders replace the old ones. Safe to call again
 * with the same body (the browser does, while the advance is still confirming): what already happened isn't repeated.
 * `advance_pending` = sent, not confirmed yet — nothing has been changed.
 */
export async function submitModify(deps: Deps, i: ModifySubmit): Promise<{ ok: true; orders: PublicOrder[] } | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  const t = i.ticket as { ciphertext?: unknown; iv?: unknown } | undefined;
  if (typeof i.groupId !== "string" || typeof i.trancheId !== "string" || !t || typeof t.ciphertext !== "string" || typeof t.iv !== "string" || t.ciphertext.length > 20_000) return fail(400, "invalid", "Invalid change.");
  const opened = deps.open(ticketAad(i.wallet, i.groupId, i.trancheId), { ciphertext: t.ciphertext, iv: t.iv });
  if (!opened) return fail(400, "invalid", "Invalid change.");
  let ticket: Ticket;
  try {
    ticket = JSON.parse(new TextDecoder().decode(opened)) as Ticket;
  } catch {
    return fail(400, "invalid", "Invalid change.");
  }
  if (ticket.wallet !== i.wallet) return fail(400, "invalid", "Invalid change.");
  const db = deps.db();
  const now = deps.now();
  const expired = () => fail(409, "expired", "That change expired — make it again.");

  // Every signature, against exactly what was prepared.
  const modified = (reason: string) =>
    fail(400, reason === "modified" ? "wallet_modified" : "invalid_signature", reason === "modified" ? "Your wallet changed the transaction before signing it, so it can't be used. Nothing was changed." : "The signature doesn't match.");
  const adv = verifySignedOrder(i.advance, { wallet: i.wallet, messageHash: ticket.advanceHash });
  if (!adv.ok) return modified(adv.reason);
  const signed = (Array.isArray(i.signed) ? i.signed : []) as { id?: unknown; transaction?: unknown }[];
  if (signed.length !== ticket.rows.length) return fail(400, "invalid", "Invalid change.");
  const rows: PandaOrderInsert[] = [];
  for (const row of ticket.rows) {
    const s = signed.find((x) => x.id === row.id);
    const v = verifySignedOrder(s?.transaction, { wallet: i.wallet, messageHash: row.messageHash });
    if (!v.ok) return modified(v.reason);
    const sealed = deps.seal(row.id, v.bytes);
    if (!sealed) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
    rows.push({ ...row, state: "active", txCiphertext: sealed.ciphertext, txIv: sealed.iv, signature: v.signature, updatedAt: now });
  }

  const result = async () => {
    const ids = new Set(ticket.rows.map((r) => r.id));
    return { ok: true as const, orders: (await pgListOrders(db, i.wallet)).filter((o) => ids.has(o.id)).map(publicOrder) };
  };
  const all = await pgListOrders(db, i.wallet);
  // Called again after it had already gone through: the same answer, nothing repeated.
  if (ticket.rows.length > 0 && ticket.rows.every((r) => all.some((o) => o.id === r.id && o.state !== "prepared"))) return result();
  const olds = all.filter((o) => ticket.replaces.includes(o.id));
  if (olds.length !== ticket.replaces.length) return expired();
  if (ticket.rows.length === 0 && olds.every((o) => o.state === "cancelled" && o.reason === "replaced")) return result();
  if (olds.some((o) => o.state !== "active" || o.nonceAccount !== ticket.old.account || o.nonceValue !== ticket.old.nonce)) return ticket.expiresAt <= now ? expired() : fail(409, "nonce_used", "That order is no longer active.");

  const [oldInfo, reserveInfo] = await deps.accounts([new PublicKey(ticket.old.account), new PublicKey(ticket.reserve.account)]);
  const oldNonce = parseNonce(ticket.old.account, oldInfo ?? null);
  const advanced = async () => (await deps.signatureStatuses([adv.signature]))[0];
  let landed = await advanced();
  if (!landed) {
    // The old nonce already moved: either this very advance landed and its status isn't visible yet (a previous call
    // sent it), or the old order executed / was cancelled meanwhile. The polls below tell which.
    const moved = !oldNonce || oldNonce.nonce !== ticket.old.nonce;
    if (!moved) {
      // Not sent yet. Before anything irreversible: is this change still the one to make?
      if (ticket.expiresAt <= now) return expired();
      // The reserve must be free and unmoved, or the new orders would be dead paper (another change took it meanwhile).
      const reserve = parseNonce(ticket.reserve.account, reserveInfo ?? null);
      const reserveBusy = (await pgLiveOrders(db, i.wallet)).some((o) => o.nonceAccount === ticket.reserve.account);
      if (!reserve || reserve.nonce !== ticket.reserve.nonce || reserveBusy) return expired();
      try {
        await deps.send(adv.bytes);
      } catch {
        // An RPC hiccup while sending: the polls below (and the browser's next call) will tell what really happened.
      }
    }
    for (let k = 0; k < ADVANCE_POLLS && !landed; k++) {
      await deps.sleep(ADVANCE_POLL_MS);
      landed = await advanced();
    }
    if (!landed && moved) return fail(409, "nonce_used", "That order is no longer active.");
  }
  if (!landed) return fail(409, "advance_pending", "The cancellation of the old order isn't confirmed yet. Nothing has been changed.");
  if (!landed.ok) return fail(409, "advance_failed", "The old order couldn't be cancelled on chain. Nothing has been changed.");

  // The old orders are now void on chain. Swap them for the new ones — all of it, or none.
  if (!(await pgReplaceActive(db, i.wallet, ticket.replaces, rows, deps.now()))) {
    // The watcher took the old order at that very moment: it can no longer land (its nonce is gone) and the watcher
    // will mark it so; the new orders are not stored, so nothing can sell twice.
    return fail(409, "busy", "That order was being executed at that moment. Check your orders.");
  }
  await deps.audit({ actor: i.wallet, action: "panda_orders.modify", object: ticket.groupId, newState: { replaced: ticket.replaces, orders: rows.map((r) => r.id), advance: adv.signature } });
  return result();
}
