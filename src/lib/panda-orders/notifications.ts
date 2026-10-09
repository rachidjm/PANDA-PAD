import type { NotificationKind, StrategyNotification } from "@/lib/strategy/notifications";

/**
 * The bell's entries for PANDA orders, derived from the orders themselves (the watcher records what happened in
 * `notice`/`noticeAt` — nothing else is stored for the history). The id includes when the notice was given, so a stop
 * that fails on slippage again an hour later is a NEW entry, while the same one is never repeated.
 */
type OrderLike = { id: string; mint: string; ticker: string; leg: string; targetUsd: number; state: string; reason: string | null; notice: string | null; noticeAt: number | null };

export function deriveOrderNotifications(orders: OrderLike[]): StrategyNotification[] {
  const out: StrategyNotification[] = [];
  for (const o of orders) {
    if (!o.notice || !o.noticeAt) continue;
    let kind: NotificationKind | null = null;
    if (o.notice === "executed" && o.state === "executed") kind = o.leg === "stop" ? "panda_stop" : "panda_sell";
    else if (o.notice === "needs_resign") kind = "panda_resign";
    else if (o.notice === "stop_slippage") kind = "panda_slippage";
    else if (o.notice === "no_sol") kind = "panda_no_sol";
    if (!kind) continue;
    out.push({ id: `${o.id}:${o.notice}:${o.noticeAt}`, strategyId: o.id, kind, mint: o.mint, ticker: o.ticker, priceUsd: o.targetUsd, reason: o.reason ?? undefined, at: o.noticeAt });
  }
  return out.sort((a, b) => b.at - a.at);
}
