import { readJson, updateJson } from "@/lib/rewards/blob-store";

export type LoggedTrade = {
  mint: string;
  ticker: string;
  side: "buy" | "sell";
  /** Real SOL amount that changed hands in this trade (exact — from the trade itself, not estimated). */
  solAmount: number;
  /** Real token amount, in UI units. */
  tokenAmount: number;
  /** Real SOL/USD price at the moment this trade was recorded — lets P&L be computed in USD without
   *  guessing a historical rate later. */
  solPriceUsdAtTrade: number;
  signature: string;
  ts: number;
  /** True when read back from on-chain history (approximate) rather than logged live by PANDA. */
  estimated?: boolean;
};

function tradeLogPath(wallet: string): string {
  return `portfolio/trades/${wallet}.json`;
}

export async function getTrades(wallet: string): Promise<LoggedTrade[]> {
  return readJson<LoggedTrade[]>(tradeLogPath(wallet), []);
}

/** Appends one real, already-confirmed trade — see src/app/api/portfolio/record-trade/route.ts for the
 *  on-chain verification that happens before this is ever called. */
export async function recordTrade(wallet: string, trade: LoggedTrade): Promise<void> {
  await updateJson<LoggedTrade[], void>(tradeLogPath(wallet), [], (trades) => {
    if (!trades.some((t) => t.signature === trade.signature)) trades.push(trade); // else already recorded
    return { next: trades, result: undefined };
  });
}
