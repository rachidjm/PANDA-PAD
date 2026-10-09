import { kindOf, validateKind, type KindIssue, type OrderKind } from "./kinds";
import { MIN_ORDER_USD } from "./plan";

/**
 * "Venta por porcentaje dibujando": several sell/stop lines on a held token's position, each covering its own
 * share of the balance. One tranche is one slice (`pct`, 1–100) with a sell price, a stop price, or both — a
 * tranche with both becomes one "oco" order (one deposit, take-profit and stop racing each other); a tranche
 * with only one leg becomes a plain "single". The sum of every tranche's `pct` can never pass 100: that is the
 * whole balance this draft is allowed to touch. Pure, so the allocation rules and the pairing rule are tested
 * without React or the chart.
 */

export type Tranche = { id: string; pct: number; sell?: number; stop?: number };

/** First row of quick picks; "Más ▾" unfolds the second row plus "Otro" (a free 1–100 entry, still capped by
 *  `remainingPct`). Order matters: this is also the order the buttons are drawn in. */
export const PCT_PRESETS = [25, 50, 75, 100] as const;
export const PCT_MORE_PRESETS = [5, 10, 15] as const;
/** The one row of % buttons Draw Your Trade shows (plus "Otro"); the marked one applies to every new line. */
export const PCT_ROW = [5, 10, 15, 20, 25, 50, 100] as const;

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** How much of the balance is already spoken for. A paired (sell+stop) tranche counts its `pct` ONCE, never twice. */
export function allocatedPct(tranches: Tranche[]): number {
  return tranches.reduce((s, t) => s + t.pct, 0);
}

/** What is left to assign, never negative (defensive: tranches are never built to exceed 100 in the first place). */
export function remainingPct(tranches: Tranche[]): number {
  return Math.max(0, 100 - allocatedPct(tranches));
}

/** Whether `pct` more can still be assigned right now — what a preset/"Otro" button checks before it's shown as usable. */
export function canAddPct(tranches: Tranche[], pct: number): boolean {
  return pct > 0 && pct <= 100 && pct <= remainingPct(tranches);
}

/**
 * The % a brand new `leg` (placed with no explicit choice — the top-level Venta/Stop tap, or a typed price
 * with nothing picked) should claim: joins an existing tranche that's missing just this leg (same pairing rule
 * `placeLeg` applies, so a sell drawn alone and a stop drawn alone at the top level still combine into one
 * "oco" order instead of two separate slices), otherwise claims whatever of the balance is still unclaimed —
 * the whole thing, for the common case of a fresh draft. 0 means there's no room left for a new slice (an
 * existing, already-paired tranche can still be retargeted through its own row, just not created this way).
 */
export function pctForNewLeg(tranches: Tranche[], leg: "sell" | "stop"): number {
  const other: "sell" | "stop" = leg === "sell" ? "stop" : "sell";
  const partner = tranches.find((t) => t[other] !== undefined && t[leg] === undefined);
  return partner ? partner.pct : remainingPct(tranches);
}

/**
 * Whether the connected wallet can draw a sell/stop on a coin it already holds, without buying first:
 * "unknown" while the balance hasn't been read (or no wallet is connected) — never treated as "none" —,
 * "none" for a real balance of 0, "has" otherwise. The balance read is the wallet's own, so it is ALREADY
 * net of the user's open orders: a Jupiter Trigger deposit moves those tokens out into Jupiter's vault.
 */
export type HeldStatus = "unknown" | "none" | "has";
export function heldStatus(tokenBalance: number | null): HeldStatus {
  if (tokenBalance === null || !Number.isFinite(tokenBalance)) return "unknown";
  return tokenBalance > 0 ? "has" : "none";
}

/** What `pct` of the free balance is worth right now, or null while either number is unknown. */
export function trancheUsd(balanceUsd: number | null, pct: number): number | null {
  return balanceUsd === null || !Number.isFinite(balanceUsd) ? null : balanceUsd * (pct / 100);
}

/**
 * The smallest whole % of the free balance that reaches the per-order minimum (MIN_ORDER_USD, Jupiter's rule):
 * null while the value is unknown; above 100 when even the whole balance falls short. Only a hint for the
 * buttons — the hard check is still validateTranches (browser) and prepareShape (server).
 */
export function minPctForOrder(balanceUsd: number | null, minUsd: number = MIN_ORDER_USD): number | null {
  if (balanceUsd === null || !Number.isFinite(balanceUsd)) return null;
  if (balanceUsd <= 0) return Infinity;
  return Math.ceil(((minUsd / balanceUsd) * 100) - 1e-9);
}

/**
 * The draft a top-level Venta/Stop tap (no buy drawn) adds its line to: the active draft if it's a held-coin
 * one (no buy), else the most recent held-coin draft, else null (the caller makes a new one). A draft with a
 * buy is never picked: its own sell/stop legs belong to the full buy→sell→stop strategy instead.
 */
export function pickHeldDraft<D extends { id: string; buy?: number }>(drafts: D[], activeId: string | null): D | null {
  const active = drafts.find((d) => d.id === activeId);
  if (active) return active.buy === undefined ? active : null;
  return [...drafts].reverse().find((d) => d.buy === undefined) ?? null;
}

/**
 * Places one leg at `pct`: if an existing tranche already has exactly this `pct` with its OTHER leg set and
 * this one still empty, the new price joins it — the pair becomes one "oco" order on the same slice, instead
 * of trying to spend that slice twice. Otherwise, when there's room, a brand new tranche is added. Returns the
 * input unchanged if `pct` no longer fits (callers are expected to have checked `canAddPct` already — this is
 * just the safe fallback, never a crash or a silently-oversized allocation).
 */
export function placeLeg(tranches: Tranche[], leg: "sell" | "stop", pct: number, price: number, opts: { allowOver?: boolean } = {}): Tranche[] {
  const other: "sell" | "stop" = leg === "sell" ? "stop" : "sell";
  const partner = tranches.find((t) => t.pct === pct && t[other] !== undefined && t[leg] === undefined);
  if (partner) return tranches.map((t) => (t.id === partner.id ? { ...t, [leg]: price } : t));
  // `allowOver`: the line is drawn anyway and the total over 100% is reported next to the confirm button (the
  // drawing never silently ignores a tap); it can't be signed until it fits.
  if (!(pct > 0 && pct <= 100) || (!opts.allowOver && !canAddPct(tranches, pct))) return tranches;
  return [...tranches, { id: newId(), pct, [leg]: price }];
}

/** Moves one leg's existing price (a drag on the chart, or typing a new value) — never changes its `pct`. */
export function updateLegPrice(tranches: Tranche[], id: string, leg: "sell" | "stop", price: number): Tranche[] {
  return tranches.map((t) => (t.id === id ? { ...t, [leg]: price } : t));
}

/** Takes one leg back out ("x" on its line). The tranche disappears once both its legs are gone. */
export function removeLeg(tranches: Tranche[], id: string, leg: "sell" | "stop"): Tranche[] {
  return tranches
    .map((t) => {
      if (t.id !== id) return t;
      const { sell, stop, ...rest } = t;
      return leg === "sell" ? { ...rest, stop } : { ...rest, sell };
    })
    .filter((t) => t.sell !== undefined || t.stop !== undefined);
}

export function removeTranche(tranches: Tranche[], id: string): Tranche[] {
  return tranches.filter((t) => t.id !== id);
}

/** Reassigns a tranche's share (editing it in the list, not on the chart). No-op if the new value doesn't fit
 *  once the OTHER tranches' shares are taken into account. */
export function setTranchePct(tranches: Tranche[], id: string, pct: number): Tranche[] {
  if (!(pct >= 1 && pct <= 100)) return tranches;
  const others = tranches.filter((t) => t.id !== id);
  if (pct > remainingPct(others)) return tranches;
  return tranches.map((t) => (t.id === id ? { ...t, pct } : t));
}

/** "sell" | "stop" | "sell_stop" for one tranche, or null for a (shouldn't-happen) empty one. */
export function trancheKind(t: Tranche): OrderKind | null {
  return kindOf({ sell: t.sell, stop: t.stop });
}

export type TrancheIssues = Map<string, KindIssue[]>;

/**
 * Every tranche's own issues (kinds.ts's rules, same as a single held-coin order — the $10 minimum, the sell
 * above/stop below checks, liquidity…), keyed by tranche id. `balanceUsd` is the value of the WHOLE position
 * right now; each tranche only risks its own `pct` share of it.
 */
export function validateTranches(tranches: Tranche[], ctx: { currentUsd: number | null; balanceUsd: number | null; liquidityUsd?: number | null; minOrderUsd?: number }): TrancheIssues {
  const out: TrancheIssues = new Map();
  for (const t of tranches) {
    const kind = trancheKind(t);
    if (!kind || kind === "buy" || kind === "buy_sell_stop") {
      out.set(t.id, ["invalid_price"]);
      continue;
    }
    const tokensUsd = ctx.balanceUsd !== null ? ctx.balanceUsd * (t.pct / 100) : null;
    out.set(t.id, validateKind(kind, { sell: t.sell, stop: t.stop }, { currentUsd: ctx.currentUsd, tokensUsd, liquidityUsd: ctx.liquidityUsd, minOrderUsd: ctx.minOrderUsd }));
  }
  return out;
}
