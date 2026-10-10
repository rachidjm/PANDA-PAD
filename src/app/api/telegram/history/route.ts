import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { asc, eq, inArray, min } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { holderPayoutRuns, pandaLaunches, telegramOutbox } from "@/lib/db/schema";
import { tgGetState, tgSetState } from "@/lib/db/telegram";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { fetchPoolOhlcv } from "@/lib/gecko/client";
import { solPriceUsd } from "@/lib/solana/prices";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { changelogSecretMatches } from "@/lib/telegram/changelog";
import { realFeedDeps } from "@/lib/telegram/deps";
import type { BuyTrade } from "@/lib/telegram/feeds";
import { buyFromTransaction, publishHistory, solPriceAt, type HistoryDeps } from "@/lib/telegram/history";

export const maxDuration = 60;
const DONE_KEY = "history.v1.done";
/** The most liquid SOL/USDC pool (Raydium): hourly candles give the SOL price at the time of each old buy. */
const SOL_USDC_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
const SCAN_BUDGET_MS = 40_000;

/**
 * ONE-OFF (removed after use): posts the history from before the bot to the group's topics — src/lib/telegram/history.ts.
 * Auth: the changelog's secret (constant time). `{ "dryRun": true }` only reports what it would post. A real run happens
 * once: afterwards this answers 409.
 */
export async function POST(req: Request) {
  const feed = realFeedDeps();
  const cfg = feed.cfg;
  if (!cfg.enabled || !cfg.changelogSecret) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`tg-history:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!changelogSecretMatches(req.headers.get("authorization"), cfg.changelogSecret)) return new NextResponse(null, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body.dryRun !== false;
  const db = getDb();
  if (!dryRun && (await tgGetState<number>(db, DONE_KEY))) return NextResponse.json({ error: "The history was already published." }, { status: 409 });
  if (!cfg.groupId) return NextResponse.json({ error: "The group isn't configured." }, { status: 503 });

  const connection = new Connection(serverRpcUrl(), "confirmed");
  const deps: HistoryDeps = {
    ...feed,
    botSince: async () => {
      const [row] = await db.select({ at: min(telegramOutbox.createdAt) }).from(telegramOutbox).where(eq(telegramOutbox.chatId, cfg.groupId!));
      return row?.at ?? null;
    },
    launches: () => db.select().from(pandaLaunches).orderBy(asc(pandaLaunches.launchedAt)).limit(5000),
    payouts: async () =>
      (await db.select().from(holderPayoutRuns).where(eq(holderPayoutRuns.status, "done")).orderBy(asc(holderPayoutRuns.finishedAt)).limit(5000)).map((r) => ({ mint: r.mint, holdersPaid: r.holdersPaid, lamportsPaid: r.lamportsPaid, finishedAt: r.finishedAt.getTime() })),
    alreadyPosted: async (keys) => {
      const found = new Set<string>();
      for (let k = 0; k < keys.length; k += 500) {
        const rows = await db.select({ key: telegramOutbox.dedupeKey }).from(telegramOutbox).where(inArray(telegramOutbox.dedupeKey, keys.slice(k, k + 500)));
        for (const r of rows) if (r.key) found.add(r.key);
      }
      return found;
    },
    buys: async (until) => {
      const started = Date.now();
      const mint = new PublicKey(feed.pandaMint);
      // Every transaction that ever touched the coin (curve and pool alike), newest first.
      const signatures: string[] = [];
      let before: string | undefined;
      for (let page = 0; page < 30; page++) {
        const list = await connection.getSignaturesForAddress(mint, { before, limit: 1000 });
        if (list.length === 0) break;
        for (const s of list) if (!s.err && s.blockTime && s.blockTime * 1000 < until) signatures.push(s.signature);
        before = list[list.length - 1].signature;
        if (list.length < 1000) break;
      }
      const candles = await fetchPoolOhlcv(SOL_USDC_POOL, "hour", 1, 1000);
      const fallback = candles.length ? 0 : await solPriceUsd();
      const buys: BuyTrade[] = [];
      let scanned = 0;
      for (let k = 0; k < signatures.length; k += 25) {
        if (Date.now() - started > SCAN_BUDGET_MS) return { buys, complete: false, scanned };
        const txs = await Promise.all(signatures.slice(k, k + 25).map((s) => connection.getParsedTransaction(s, { maxSupportedTransactionVersion: 0 }).catch(() => null)));
        for (const tx of txs) {
          scanned++;
          const price = tx?.blockTime ? solPriceAt(candles, tx.blockTime * 1000) || fallback : 0;
          const buy = price > 0 ? buyFromTransaction(tx, feed.pandaMint, price) : null;
          if (buy) buys.push(buy);
        }
      }
      return { buys, complete: true, scanned };
    },
  };

  const report = await publishHistory(deps, { dryRun });
  if (!dryRun) {
    await tgSetState(db, DONE_KEY, Date.now(), Date.now());
    await recordAudit({ actor: "system:telegram-history", action: "telegram.history.publish", object: "group", newState: { newCoins: report.topics.newCoins.queued, buys: report.topics.buys.queued, payouts: report.topics.payouts.queued } });
  }
  return NextResponse.json({ ...report, until: new Date(report.until).toISOString(), minBuyUsd: cfg.minBuyUsd, mint: feed.pandaMint });
}
