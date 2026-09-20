import type { GeckoPool, GeckoTrade } from "@/lib/gecko/client";
import type { PumpCoin } from "@/lib/pump/frontend-api";
import { ACTIVITY_CONFIG as C } from "./config";
import type { CoinMeta, FeedEvent } from "./types";

/**
 * Pure translations from what the public indexers return into feed events. Each drops anything that
 * doesn't parse into a well-formed event instead of guessing, and never uses a flagged (NSFW / banned) coin.
 */

const SOL_DECIMALS = 1_000_000_000;

/** A pool trade of a SOL-quoted pool. `from`/`to` are quote/base for a buy and the reverse for a sell. */
export function tradeToEvent(t: GeckoTrade, mint: string, meta: CoinMeta): FeedEvent | null {
  const a = t?.attributes;
  if (!a || (a.kind !== "buy" && a.kind !== "sell") || !a.tx_hash) return null;
  const ts = Date.parse(a.block_timestamp);
  const sol = Number(a.kind === "buy" ? a.from_token_amount : a.to_token_amount);
  const tokens = Number(a.kind === "buy" ? a.to_token_amount : a.from_token_amount);
  if (!Number.isFinite(ts) || !Number.isFinite(sol) || !(sol > 0) || !Number.isFinite(tokens) || tokens < 0) return null;
  return {
    id: `trade:${a.tx_hash}`,
    kind: a.kind,
    ts,
    mint,
    wallet: a.tx_from_address || undefined,
    lamports: Math.round(sol * SOL_DECIMALS),
    tokenAmount: tokens,
    signature: a.tx_hash,
    ...meta,
  };
}

/** A coin's launch, from Pump.fun's own feed. Only coins with real traction and not flagged. */
export function launchToEvent(c: PumpCoin): FeedEvent | null {
  if (c.nsfw || c.banned || !(c.usdMarketCap >= C.launchMinMarketCapUsd)) return null;
  const ts = Date.parse(c.createdAt);
  if (!Number.isFinite(ts)) return null;
  return { id: `created:${c.mint}`, kind: "token_created", ts, mint: c.mint, wallet: c.creator || undefined, ticker: c.symbol, name: c.name, image: c.image };
}

/**
 * A graduation: a PumpSwap pool created recently for a coin Pump.fun itself says has graduated. The pool's creation time
 * is the moment of graduation (PumpSwap pools of graduated coins are created by the migration). Only pools that rank among the
 * active ones are seen, so this is "recent graduations of coins with activity", not every graduation.
 */
export function graduationToEvent(pool: GeckoPool, mint: string, pump: PumpCoin | undefined, now: number): FeedEvent | null {
  if (!pump || !pump.graduated || pump.nsfw || pump.banned) return null;
  const created = pool.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : NaN;
  if (!Number.isFinite(created) || created > now + C.maxFutureMs || now - created > C.graduationWindowMs) return null;
  return { id: `grad:${mint}`, kind: "graduation", ts: created, mint, wallet: pump.creator || undefined, ticker: pump.symbol, name: pump.name, image: pump.image };
}
