import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { verifyEd25519 } from "@/lib/auth/wallet-auth";
import { pgLiveOrders, pgReplaceActive, pgTransition, type PandaOrderInsert, type PandaOrderRow } from "@/lib/db/panda-orders";
import { committedRaw, feeFor, minOutFor, triggerOutFor, validateTranches, type Leg, type OrderState, type TrancheIssue } from "./math";
import { messageHash, orderTransaction, PACKET_LIMIT, parseNonce, verifySignedOrder } from "./tx";
import { fail, ID_RE, key, publicOrder, requiredLamports, simulateOrFail, solCheck, type Deps, type Failure, type PublicOrder } from "./service";

/**
 * Changing a live order (its price, or its tranche's %) with ONE approval and no new deposit.
 *
 * The new order is signed on the SAME nonce value as the one it replaces, so nothing has to land on chain: the twin leg
 * of the tranche stays valid as it is, and whichever leg fills first still advances the nonce and kills the rest. The old
 * signed transaction only ever existed encrypted in PANDA's database; replacing it erases those bytes in the same
 * database transaction that stores the new ones. If the user never signs, nothing is touched.
 *
 * Nothing is stored between "prepare" and "submit": what was prepared travels as a ticket sealed with PANDA's orders key
 * (AES-GCM, bound to the order it replaces), so the browser can't change one figure of it.
 */

export const MODIFY_TTL_MS = 10 * 60_000;

export type ModifyInput = { wallet: string; groupId: unknown; trancheId: unknown; sellUsd?: unknown; stopUsd?: unknown; pct?: unknown; riskAccepted: unknown };
export type ModifyPrepared = { replaces: string; id: string; leg: Leg; transaction: string; ticket: { ciphertext: string; iv: string } };

type Ticket = { row: PandaOrderInsert; replaces: string; expiresAt: number };
const ticketAad = (replaces: string) => `modify:${replaces}`;
const price = (v: unknown): number | undefined | null => (v === undefined || v === null ? undefined : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export async function prepareModify(deps: Deps, i: ModifyInput): Promise<{ ok: true; orders: ModifyPrepared[] } | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  const wallet = key(i.wallet);
  if (!wallet) return fail(400, "invalid", "Invalid wallet.");
  if (typeof i.groupId !== "string" || !ID_RE.test(i.groupId) || typeof i.trancheId !== "string") return fail(400, "invalid", "Invalid order.");
  const sellIn = price(i.sellUsd);
  const stopIn = price(i.stopUsd);
  if (sellIn === null || stopIn === null) return fail(400, "invalid", "Invalid price.");
  if (i.pct !== undefined && !(typeof i.pct === "number" && i.pct > 0 && i.pct <= 100)) return fail(400, "invalid", "Invalid percentage.");

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

  const pct = (i.pct as number | undefined) ?? first.pct;
  const pctChanged = pct !== first.pct;
  const target: Record<Leg, number | undefined> = { sell: sellIn ?? sell?.targetUsd, stop: stopIn ?? stop?.targetUsd };
  const changed = legs.filter((o) => pctChanged || target[o.leg as Leg] !== o.targetUsd);
  if (changed.length === 0) return fail(400, "no_change", "Nothing changed.");
  // The same warning as when a stop is first signed.
  if (changed.some((o) => o.leg === "stop") && i.riskAccepted !== true) return fail(400, "risk_not_accepted", "Accept the stop warning first.");

  const mint = new PublicKey(first.mint);
  const { tokenUsd } = await deps.quoteUsd(first.mint);
  if (!tokenUsd || !(tokenUsd > 0)) return fail(503, "price_unavailable", "No live price for this coin right now.");
  const checked = validateTranches([{ trancheId: first.trancheId, pct, sellUsd: target.sell, stopUsd: target.stop }], tokenUsd);
  if (typeof checked === "string") return fail(400, checked, "This line can't be placed there.");
  const issues = Object.fromEntries([...checked.entries()].filter(([, v]) => v.length > 0)) as Record<string, TrancheIssue[]>;
  if (Object.keys(issues).length) return fail(422, "issues", "This line can't be placed there.", issues);

  const venue = await deps.loadVenue(mint, wallet, first.pool ? new PublicKey(first.pool) : undefined);
  if (venue === "not_found") return fail(404, "not_found", "That coin wasn't found on-chain.");
  if (venue === "unsupported" || venue.venue !== first.venue) return fail(422, "unsupported_coin", "This coin changed market: cancel the order and place it again.");

  // The nonce must still be exactly the one the live legs were signed on: that is what lets the pair keep working.
  const [info] = await deps.accounts([new PublicKey(first.nonceAccount)]);
  const nonce = parseNonce(first.nonceAccount, info ?? null);
  if (!nonce || nonce.authority !== i.wallet || nonce.nonce !== first.nonceValue) return fail(409, "nonce_used", "That order is no longer active.");

  // A new % scales the amount the tranche was signed for; it must still fit in what no OTHER order has promised.
  const oldAmount = BigInt(first.tokenAmountRaw);
  const amount = pctChanged ? (oldAmount * BigInt(Math.round(pct * 100))) / BigInt(Math.round(first.pct * 100)) : oldAmount;
  if (amount <= BigInt(0)) return fail(422, "issues", "This line is too small to sell anything.", { [first.trancheId]: ["amount_zero"] });
  const balance = await deps.tokenBalance(wallet, mint, venue.tokenProgram);
  const others = live.filter((o) => o.mint === first.mint && o.nonceAccount !== first.nonceAccount && o.state !== "prepared");
  const free = balance.raw - committedRaw(others.map((o) => ({ nonceAccount: o.nonceAccount, tokenAmountRaw: o.tokenAmountRaw, state: o.state as OrderState })));
  if (amount > free) return fail(422, "no_balance", "You don't have that much of this coin free of other orders.");

  const short = await solCheck(deps, wallet, requiredLamports(0, 1, 0));
  if (short) return short;

  const feeBps = await deps.feeBps(i.wallet);
  const lookupTable = await deps.lookupTable();
  const current = deps.quoteOut(venue, amount);
  const out: ModifyPrepared[] = [];
  for (const old of changed) {
    const leg = old.leg as Leg;
    const targetUsd = target[leg]!;
    const trigger = triggerOutFor(current, targetUsd, tokenUsd);
    const minOut = minOutFor(trigger, leg);
    if (minOut <= BigInt(0)) return fail(422, "issues", "This line is too small to sell anything.", { [first.trancheId]: ["amount_zero"] });
    const fee = feeFor(minOut, feeBps);
    const tx = orderTransaction({
      wallet,
      nonceAccount: new PublicKey(first.nonceAccount),
      nonceValue: first.nonceValue,
      sale: await deps.saleInstructions(venue, wallet, amount, minOut),
      fee: await deps.feeInstructions(wallet, fee),
      lookupTable,
    });
    const bytes = tx.serialize();
    if (bytes.length > PACKET_LIMIT) return fail(422, "too_large", "This order doesn't fit in one Solana transaction.");
    const bad = await simulateOrFail(deps, bytes, leg);
    if (bad) return bad.code === "nonce_pending" ? fail(409, "nonce_used", "That order is no longer active.") : bad;
    const id = deps.newId();
    const row: PandaOrderInsert = {
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
      nonceAccount: first.nonceAccount,
      nonceValue: first.nonceValue,
      tokenAmountRaw: amount.toString(),
      tokenDecimals: first.tokenDecimals,
      triggerOutLamports: Number(trigger),
      minOutLamports: Number(minOut),
      feeLamports: Number(fee),
      targetUsd,
      refUsd: tokenUsd,
      state: "active",
      messageHash: messageHash(tx.message.serialize()),
      createdAt: old.createdAt, // it keeps its place in the list: it is the same order, changed
      updatedAt: now,
    };
    const ticket: Ticket = { row, replaces: old.id, expiresAt: now + MODIFY_TTL_MS };
    const sealed = deps.seal(ticketAad(old.id), new TextEncoder().encode(JSON.stringify(ticket)));
    if (!sealed) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
    out.push({ replaces: old.id, id, leg, transaction: Buffer.from(bytes).toString("base64"), ticket: sealed });
  }
  return { ok: true, orders: out };
}

/** The signed replacements — each checked byte for byte against its sealed ticket — swap in for the old orders, all or none. */
export async function submitModify(deps: Deps, i: { wallet: string; signed: unknown }): Promise<{ ok: true; orders: PublicOrder[] } | Failure> {
  if (!deps.hasKey()) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
  const signed = (Array.isArray(i.signed) ? i.signed : []) as { replaces?: unknown; transaction?: unknown; ticket?: unknown }[];
  if (signed.length === 0 || signed.length > 2) return fail(400, "invalid", "Nothing to submit.");
  const db = deps.db();
  const now = deps.now();
  const expired = () => fail(409, "expired", "That change expired — make it again.");
  const live = await pgLiveOrders(db, i.wallet);
  const swaps: { replaces: string; row: PandaOrderInsert }[] = [];
  for (const s of signed) {
    const t = s.ticket as { ciphertext?: unknown; iv?: unknown } | undefined;
    if (typeof s.replaces !== "string" || !t || typeof t.ciphertext !== "string" || typeof t.iv !== "string" || t.ciphertext.length > 8000) return fail(400, "invalid", "Invalid change.");
    const opened = deps.open(ticketAad(s.replaces), { ciphertext: t.ciphertext, iv: t.iv });
    if (!opened) return fail(400, "invalid", "Invalid change.");
    let ticket: Ticket;
    try {
      ticket = JSON.parse(new TextDecoder().decode(opened)) as Ticket;
    } catch {
      return fail(400, "invalid", "Invalid change.");
    }
    if (ticket.replaces !== s.replaces || ticket.row.wallet !== i.wallet) return fail(400, "invalid", "Invalid change.");
    if (ticket.expiresAt <= now) return expired();
    const old = live.find((o) => o.id === s.replaces);
    if (!old || old.state !== "active" || old.nonceValue !== ticket.row.nonceValue || old.nonceAccount !== ticket.row.nonceAccount || old.leg !== ticket.row.leg) return expired();
    const v = verifySignedOrder(s.transaction, { wallet: i.wallet, messageHash: ticket.row.messageHash });
    if (!v.ok) {
      return fail(400, v.reason === "modified" ? "wallet_modified" : "invalid_signature", v.reason === "modified" ? "Your wallet changed the transaction before signing it, so it can't be stored. Nothing was saved." : "The signature doesn't match.");
    }
    const sealed = deps.seal(ticket.row.id, v.bytes);
    if (!sealed) return fail(503, "not_configured", "PANDA orders aren't configured on this deployment.");
    swaps.push({ replaces: s.replaces, row: { ...ticket.row, state: "active", txCiphertext: sealed.ciphertext, txIv: sealed.iv, signature: v.signature, updatedAt: now } });
  }
  if (new Set(swaps.map((x) => x.replaces)).size !== swaps.length || new Set(swaps.map((x) => x.row.nonceAccount)).size !== 1) return fail(400, "invalid", "Invalid change.");
  // The nonce hasn't moved while the user was signing (the twin leg filling, a cancel): otherwise the new order is dead paper.
  const account = swaps[0].row.nonceAccount;
  const [info] = await deps.accounts([new PublicKey(account)]);
  const nonce = parseNonce(account, info ?? null);
  if (!nonce || nonce.nonce !== swaps[0].row.nonceValue) return fail(409, "nonce_used", "That order is no longer active.");
  if (!(await pgReplaceActive(db, i.wallet, swaps, now))) return expired();
  await deps.audit({ actor: i.wallet, action: "panda_orders.modify", object: swaps[0].row.groupId, newState: { replaced: swaps.map((x) => x.replaces), orders: swaps.map((x) => x.row.id) } });
  const ids = new Set(swaps.map((x) => x.row.id));
  const rows: PandaOrderRow[] = (await pgLiveOrders(db, i.wallet)).filter((o) => ids.has(o.id));
  return { ok: true, orders: rows.map(publicOrder) };
}

// ── cancelling ONE line of a tranche that has two ──────────────────────────────────────────────────────────────────

export const CANCEL_LEG_TTL_MS = 5 * 60_000;

/** What the wallet signs to drop one line: it names the site, the wallet, the order and when. Free, nothing on chain. */
export function cancelLegMessage(p: { domain: string; wallet: string; order: Pick<PandaOrderRow, "id" | "leg" | "ticker" | "pct" | "targetUsd">; issuedAt: number }): string {
  return [
    "PANDA: cancel one order line.",
    "",
    `Domain: ${p.domain}`,
    `Wallet: ${p.wallet}`,
    `Order: ${p.order.id}`,
    `Line: ${p.order.leg === "sell" ? "Sell" : "Stop"} ${p.order.pct}% of ${p.order.ticker} at $${p.order.targetUsd}`,
    `Issued At: ${new Date(p.issuedAt).toISOString()}`,
    "",
    "Signing is free and does not move any funds. The other line of this order keeps working.",
  ].join("\n");
}

/**
 * Drops ONE leg of a tranche whose other leg stays live on the same nonce (the last leg is cancelled by closing the
 * account instead — that also returns the deposit). Like every cancel it takes the wallet's signature: here over a
 * message the server rebuilds itself. The stored signed transaction of that leg is erased.
 * Without `signature`: returns the message to sign. With it: verifies and cancels.
 */
export async function cancelLeg(
  deps: Deps,
  i: { wallet: string; orderId: unknown; issuedAt?: unknown; signature?: unknown; domain: string }
): Promise<{ ok: true; message: string; issuedAt: number } | { ok: true; cancelled: string } | Failure> {
  if (typeof i.orderId !== "string" || !ID_RE.test(i.orderId)) return fail(400, "invalid", "Invalid order.");
  const db = deps.db();
  const now = deps.now();
  const live = (await pgLiveOrders(db, i.wallet)).filter((o) => o.state !== "prepared");
  const order = live.find((o) => o.id === i.orderId);
  if (!order) return fail(404, "nothing", "That order is no longer active.");
  if (order.state !== "active") return fail(409, "busy", "That order is being executed right now.");
  if (!live.some((o) => o.nonceAccount === order.nonceAccount && o.id !== order.id)) return fail(409, "last_leg", "This is the only line of its order: cancel the order instead.");
  if (i.signature === undefined) return { ok: true, message: cancelLegMessage({ domain: i.domain, wallet: i.wallet, order, issuedAt: now }), issuedAt: now };
  if (typeof i.issuedAt !== "number" || !Number.isFinite(i.issuedAt) || typeof i.signature !== "string" || i.signature.length > 128) return fail(400, "invalid", "Invalid request.");
  if (i.issuedAt > now + 60_000 || now - i.issuedAt > CANCEL_LEG_TTL_MS) return fail(409, "expired", "That request expired — try again.");
  let sig: Uint8Array;
  try {
    sig = bs58.decode(i.signature);
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  const message = cancelLegMessage({ domain: i.domain, wallet: i.wallet, order, issuedAt: i.issuedAt });
  if (!verifyEd25519(new TextEncoder().encode(message), sig, new PublicKey(i.wallet).toBytes())) return fail(400, "invalid_signature", "The signature doesn't match.");
  const done = await pgTransition(db, order.id, ["active"], { state: "cancelled", reason: "user_cancelled" }, now);
  if (!done) return fail(409, "busy", "That order is being executed right now.");
  await deps.audit({ actor: i.wallet, action: "panda_orders.cancel_leg", object: order.id });
  return { ok: true, cancelled: order.id };
}
