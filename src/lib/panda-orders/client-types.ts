/**
 * What the browser sees of PANDA orders (/api/panda-orders/list) — mirrors service.ts's PublicOrder without importing
 * any server code. Never any signed bytes.
 */
export type ClientOrder = {
  id: string;
  wallet: string;
  mint: string;
  ticker: string;
  groupId: string;
  trancheId: string;
  n: number;
  leg: "sell" | "stop";
  venue: "curve" | "amm";
  pool: string | null;
  pct: number;
  nonceAccount: string;
  tokenAmountRaw: string;
  tokenDecimals: number;
  triggerOutLamports: number;
  minOutLamports: number;
  feeLamports: number;
  targetUsd: number;
  refUsd: number;
  state: "prepared" | "active" | "sending" | "executed" | "cancelled" | "needs_resign";
  reason: string | null;
  signature: string | null;
  notice: string | null;
  noticeAt: number | null;
  executedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type OrdersList = { orders: ClientOrder[]; committedRaw: string | null; freeNonces: string[]; rentLamports: number };

/** One drawn strategy's PANDA orders, grouped back into its tranches (each tranche: its sell and/or stop leg). */
export type OrderGroup = { groupId: string; n: number; ticker: string; tranches: { trancheId: string; pct: number; legs: ClientOrder[] }[] };

export const LIVE = new Set<ClientOrder["state"]>(["prepared", "active", "sending"]);

export function groupOrders(orders: ClientOrder[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const o of orders) {
    if (!groups.has(o.groupId)) groups.set(o.groupId, { groupId: o.groupId, n: o.n, ticker: o.ticker, tranches: [] });
    const g = groups.get(o.groupId)!;
    let t = g.tranches.find((x) => x.trancheId === o.trancheId && x.legs[0]?.nonceAccount === o.nonceAccount);
    if (!t) {
      t = { trancheId: o.trancheId, pct: o.pct, legs: [] };
      g.tranches.push(t);
    }
    t.legs.push(o);
  }
  // Newest strategy first; inside a tranche the sell before the stop.
  for (const g of groups.values()) for (const t of g.tranches) t.legs.sort((a, b) => (a.leg === b.leg ? 0 : a.leg === "sell" ? -1 : 1));
  return [...groups.values()].sort((a, b) => Math.max(...b.tranches.flatMap((t) => t.legs.map((l) => l.createdAt))) - Math.max(...a.tranches.flatMap((t) => t.legs.map((l) => l.createdAt))));
}

/** Rough deposit per order account, for the text shown before signing (the exact figure comes from the chain). */
export const NONCE_DEPOSIT_LAMPORTS_ESTIMATE = 1_056_640;
