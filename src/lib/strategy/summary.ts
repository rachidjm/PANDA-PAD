import type { Legs } from "./kinds";

/**
 * The one-line summary of a draft ("Compra a $0,0012 · sin stop", "Venta del 50% a $0,0020"), as translation keys
 * with their values, so the panel translates them and the rule itself is tested without React. The percentage is
 * shown only when the sale isn't the whole balance (100% reads as plain "Venta a …").
 */
export type SummaryPart =
  | { key: "draw.sum.buy"; price: number }
  | { key: "draw.sum.sell"; price: number }
  | { key: "draw.sum.sellPct"; price: number; pct: number }
  | { key: "draw.sum.stop"; price: number }
  | { key: "draw.sum.stopPct"; price: number; pct: number }
  | { key: "draw.sum.noStop" };

export function summaryParts(legs: Legs, pct: number): SummaryPart[] {
  const parts: SummaryPart[] = [];
  const partial = pct < 100;
  if (legs.buy !== undefined) parts.push({ key: "draw.sum.buy", price: legs.buy });
  if (legs.sell !== undefined) parts.push(partial ? { key: "draw.sum.sellPct", price: legs.sell, pct } : { key: "draw.sum.sell", price: legs.sell });
  if (legs.stop !== undefined) parts.push(partial ? { key: "draw.sum.stopPct", price: legs.stop, pct } : { key: "draw.sum.stop", price: legs.stop });
  // A buy with no stop is the case the user must be able to see at a glance.
  if (legs.buy !== undefined && legs.stop === undefined) parts.push({ key: "draw.sum.noStop" });
  return parts;
}

/** Whether a buy without a stop loss needs the discreet "not sold automatically" line. */
export function needsNoStopNotice(legs: Legs): boolean {
  return legs.buy !== undefined && legs.stop === undefined;
}
