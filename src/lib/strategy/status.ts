import type { TriggerOrder } from "@/lib/jupiter/trigger";
import type { RecordState, StrategyStatus } from "./types";
import { TERMINAL } from "./types";
import { startsWithBuy, type OrderKind } from "./kinds";

/**
 * Turns what Jupiter reports about an order into a strategy status. Two rules:
 *
 *  1. A price touching a line means nothing. BUY and SELL only count once Jupiter reports a fill WITH a
 *     transaction signature and that transaction is confirmed on-chain (`verifyTx`).
 *  2. SELL can never be counted without a verified BUY: an exit fill on an order whose entry isn't proven is ignored.
 *
 * Anything this doesn't recognise leaves the status unchanged (`status: null`) rather than guessing.
 */

const BUY_CONTEXT = new Set(["buy_below", "buy_above"]);
const SELL_CONTEXT = new Set(["take_profit", "stop_loss"]);

export type Derived = {
  status: StrategyStatus | null;
  buySignature?: string;
  sellSignature?: string;
  sellKind?: "take_profit" | "stop_loss";
  holdsTokens?: boolean;
  /** Why nothing changed, for logs and the UI. */
  unrecognised?: string;
};

/**
 * Shapes that SELL a held token (single sell, single stop, oco) have no buy to prove, so the rule is simpler: the
 * order is completed only when Jupiter reports it `filled` AND its fill transaction is confirmed on-chain. Jupiter's
 * docs name the fill contexts take_profit / stop_loss for the OTOCO only, so this doesn't rely on a context value
 * for a standalone sell or stop: the signature of a verified fill is the proof, and the context is recorded only
 * when it is one of the two documented exit names.
 */
export async function deriveHeldStatus(order: TriggerOrder, verifyTx: (signature: string) => Promise<boolean>): Promise<Derived> {
  const events = Array.isArray(order.events) ? order.events : [];
  const fill = events.find((e) => e && e.type === "fill" && typeof e.txSignature === "string");
  const state = order.orderState;
  if (state === "failed") return { status: "failed" };
  if (state === "cancelled" || state === "expired") return { status: "cancelled" };
  if (state === "filled" && fill && (await verifyTx(fill.txSignature as string))) {
    const context = fill.orderContext;
    const sellKind = context === "take_profit" || context === "stop_loss" ? context : undefined;
    return { status: "completed", sellSignature: fill.txSignature, ...(sellKind ? { sellKind } : {}) };
  }
  if (state === "executing") return { status: "sell_triggered" };
  if (state === "pending" || state === "open") return { status: "waiting" };
  return { status: null, unrecognised: `state "${state}" with no verifiable fill` };
}

export async function deriveStatus(order: TriggerOrder, verifyTx: (signature: string) => Promise<boolean>, kind?: OrderKind): Promise<Derived> {
  if (kind && !startsWithBuy(kind)) return deriveHeldStatus(order, verifyTx);
  const events = Array.isArray(order.events) ? order.events : [];
  const fills = events.filter((e) => e && typeof e.txSignature === "string" && typeof e.orderContext === "string");
  const buyFill = fills.find((e) => BUY_CONTEXT.has(e.orderContext as string));
  const sellFill = fills.find((e) => SELL_CONTEXT.has(e.orderContext as string));

  const buyOk = !!buyFill && (await verifyTx(buyFill.txSignature as string));
  const sellOk = buyOk && !!sellFill && (await verifyTx(sellFill.txSignature as string));
  const out: Derived = { status: null };
  if (buyOk) out.buySignature = buyFill!.txSignature;
  if (sellOk) {
    out.sellSignature = sellFill!.txSignature;
    out.sellKind = sellFill!.orderContext as "take_profit" | "stop_loss";
    return { ...out, status: "completed" };
  }

  const state = order.orderState;
  if (state === "failed") return { ...out, status: "failed", holdsTokens: buyOk || undefined };
  if (state === "cancelled" || state === "expired") return { ...out, status: "cancelled", holdsTokens: buyOk || undefined };

  if (buyOk) return { ...out, status: state === "executing" || !!sellFill ? "sell_triggered" : "position_open" };
  if (state === "executing") return { ...out, status: "buy_triggered" };
  if (state === "pending" || state === "open") return { ...out, status: "waiting" };
  return { ...out, unrecognised: `state "${state}" with no verifiable fill` };
}

const RANK: Record<StrategyStatus, number> = {
  waiting: 0,
  buy_triggered: 1,
  position_open: 2,
  sell_triggered: 3,
  completed: 4,
  failed: 4,
  cancelled: 4,
};

/** A finished strategy never changes again, and an active one never goes backwards. */
export function canAdvance(from: RecordState, to: StrategyStatus): boolean {
  if (TERMINAL.includes(from)) return false;
  if (from === "prepared" || from === "creating") return false;
  return RANK[to] >= RANK[from as StrategyStatus];
}
