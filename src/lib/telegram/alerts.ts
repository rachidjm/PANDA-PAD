import type { Db } from "@/lib/db/client";
import { tgEnqueue, tgFireAlert, tgLiveAlerts, type Lang } from "@/lib/db/telegram";
import type { Market, Quote } from "./market";
import { esc, price, tt, usd } from "./text";

export const MAX_ALERTS = 10;
export const MAX_WATCH = 20;

export type AlertSpec = { metric: "price" | "mcap"; direction: "above" | "below"; value: number };

/** "price above 0.001", "mcap below 1.5m", "mcap above 100k" → the alert, or null. Values: price ≤ 1,000,000 $, mcap ≤ 10 trillion $. */
export function parseAlertSpec(args: string[]): AlertSpec | null {
  if (args.length !== 3) return null;
  const metric = args[0].toLowerCase();
  const direction = args[1].toLowerCase();
  if (metric !== "price" && metric !== "mcap") return null;
  if (direction !== "above" && direction !== "below") return null;
  const m = /^\$?(\d+(?:[.,]\d+)?)(k|m|b)?$/i.exec(args[2].trim());
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  const value = Number(m[1].replace(",", ".")) * mult;
  if (!(value > 0) || !Number.isFinite(value)) return null;
  if (metric === "price" && value > 1_000_000) return null;
  if (metric === "mcap" && value > 1e13) return null;
  return { metric, direction, value };
}

export const currentOf = (q: Quote | undefined, metric: "price" | "mcap"): number | null => {
  const v = metric === "price" ? q?.priceUsd : q?.marketCap;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
};

export const isCrossed = (spec: AlertSpec, current: number) => (spec.direction === "above" ? current >= spec.value : current <= spec.value);

export const fmtMetric = (metric: "price" | "mcap", v: number, lang: Lang) => (metric === "price" ? price(v, lang) : usd(v, lang));

/**
 * Checks every live alert against ONE round of quotes (one batched read for all their coins). An alert fires once: the
 * database marks it fired before its message is queued, so two overlapping runs can't both send it. A coin with no fresh
 * number this round is simply skipped — never fired on a missing or zero value.
 */
export async function evaluateAlerts(d: { db: Db; market: Market; now: () => number }): Promise<{ checked: number; fired: number }> {
  const alerts = await tgLiveAlerts(d.db);
  if (alerts.length === 0) return { checked: 0, fired: 0 };
  const quotes = await d.market.quotes([...new Set(alerts.map((a) => a.mint))]);
  let fired = 0;
  for (const a of alerts) {
    const spec: AlertSpec = { metric: a.metric as AlertSpec["metric"], direction: a.direction as AlertSpec["direction"], value: a.value };
    const current = currentOf(quotes.get(a.mint), spec.metric);
    if (current === null || !isCrossed(spec, current)) continue;
    if (!(await tgFireAlert(d.db, a.id, d.now()))) continue;
    const lang = (a.lang === "es" ? "es" : "en") as Lang;
    await tgEnqueue(
      d.db,
      {
        chatId: String(a.telegramId),
        method: "sendMessage",
        dedupeKey: `alert:${a.id}`,
        payload: {
          parse_mode: "HTML",
          text: tt(lang, "alertFired", {
            ticker: `$${esc(a.ticker)}`,
            metric: tt(lang, spec.metric === "price" ? "metricPrice" : "metricMcap"),
            direction: tt(lang, spec.direction),
            value: fmtMetric(spec.metric, spec.value, lang),
            current: fmtMetric(spec.metric, current, lang),
          }),
        },
      },
      d.now()
    );
    fired++;
  }
  return { checked: alerts.length, fired };
}
