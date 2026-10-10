/**
 * What REALLY happened to a trade, when the wallet or the confirmation didn't give a straight answer.
 *
 * A wallet can report an error after it already broadcast the transaction, and a confirmation can time out on a
 * transaction that then lands. Showing "failed" there is wrong (and invites buying twice). The coin's balance in the
 * wallet is the ground truth: a buy that landed raised it, a sell that landed lowered it.
 */

export type TradeSide = "buy" | "sell";

/** The user said no in the wallet: nothing was sent, there is nothing to look for on chain. */
export function isRejection(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return /WalletSignTransactionError|WalletSendTransactionError/.test(name) ? /reject|denied|cancel|declin/i.test(message) : /user rejected|rejected the request|denied|cancell?ed by user/i.test(message);
}

/** Did the wallet's balance of the coin move the way this trade moves it? `null` = one of the reads isn't known. */
export function balanceMoved(side: TradeSide, beforeRaw: bigint | null, afterRaw: bigint | null): boolean | null {
  if (beforeRaw === null || afterRaw === null) return null;
  return side === "buy" ? afterRaw > beforeRaw : afterRaw < beforeRaw;
}

export type Settled = "landed" | "not_seen";

/**
 * Re-reads the balance until it has moved the way the trade moves it, or the time runs out. Never throws: a read that
 * fails is just tried again.
 */
export async function settleByBalance(p: {
  side: TradeSide;
  beforeRaw: bigint | null;
  read: () => Promise<bigint | null>;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  everyMs?: number;
}): Promise<Settled> {
  if (p.beforeRaw === null) return "not_seen";
  const sleep = p.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let k = 0; k < (p.attempts ?? 10); k++) {
    let after: bigint | null = null;
    try {
      after = await p.read();
    } catch {
      after = null;
    }
    if (balanceMoved(p.side, p.beforeRaw, after)) return "landed";
    await sleep(p.everyMs ?? 2500);
  }
  return "not_seen";
}

/** "5,37M" / "1.250" / "0,0042" — a token amount short enough for one line, in the page's language. */
export function compactAmount(n: number, lang: string): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10_000) return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 2 }).format(n);
  return new Intl.NumberFormat(lang, { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 4 }).format(n);
}

/** "18,80 $" / "$18.80" (under a cent: "< 0,01 $"). null when there is no price to value it with. */
export function holdingValue(tokens: number, priceUsd: number | null | undefined, lang: string): string | null {
  if (!priceUsd || !(priceUsd > 0) || !(tokens > 0)) return null;
  const usd = tokens * priceUsd;
  const fmt = new Intl.NumberFormat(lang, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return usd < 0.01 ? `< ${fmt.format(0.01)}` : fmt.format(usd);
}
