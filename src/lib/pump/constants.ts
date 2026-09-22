import { PublicKey } from "@solana/web3.js";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";

/**
 * Constants safe to import from client components — no `@pump-fun/pump-sdk`
 * import here, since that package isn't browser-bundle friendly (see
 * client.ts). Anything that needs the SDK itself lives server-side, behind
 * /api/pump/*.
 */

export const DEFAULT_SLIPPAGE_PCT = 5;

/**
 * PANDA's cut of every buy/sell routed through the app, taken as a plain SOL
 * transfer bundled into the same transaction as the Pump.fun trade — the
 * user sees and approves it in their wallet alongside the trade itself.
 * Only applies to trades on existing coins; it is unrelated to Pump.fun's
 * own protocol/creator fees, which are unchanged.
 */
/**
 * Priority fee on every trade, in micro-lamports per compute unit. Without one, a transaction sits behind every transaction
 * that offers something, and on a busy network (which is when memecoins trade) it expires unconfirmed. 100,000 micro-lamports
 * on the 300,000-unit limit is at most 30,000 lamports (0.00003 SOL, about half a cent).
 */
export const PRIORITY_FEE_MICRO_LAMPORTS = 100_000;

export const PANDA_FEE_BPS = 50; // 0.5% on each buy and each sell (1% for a round trip)

export const PANDA_TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_PANDA_TREASURY || "GJvaNLciu58gCyJap2tzGam76SS1w2Bg9bHbfKyzxb8m"
);

/**
 * PANDA's fixed cut of every coin's Fee Distribution — not configurable by
 * the creator, not skippable. Paid to PANDA_TREASURY, same wallet as the 1%
 * trading fee above (a second, distinct real revenue stream into it). See
 * FeeDistributionStep.tsx: the creator only ever chooses how the *remaining*
 * 9500 bps is split (Creator vs Holders).
 */
export const PANDA_PROTOCOL_FEE_BPS = PANDA_SHARE_BPS; // 5% — single source of truth in lib/config/protocol.ts

/**
 * Where a coin's "Holders" creator-fee share lands, when a creator opts into
 * Fee Distribution — a real Solana address, public key only. PANDA never
 * holds this wallet's private key in the frontend/repo; the server-side
 * signer that pays individual holders out of it (see src/lib/rewards/,
 * src/app/api/rewards/claim, src/app/api/cron/collect-fees) reads a
 * server-only PANDA_REWARDS_POOL_SECRET_KEY that's never in this file or any
 * NEXT_PUBLIC_* variable. `null` when unset, so callers can render an honest
 * "not configured" state instead of a fake address.
 */
export const PANDA_REWARDS_POOL = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL
  ? new PublicKey(process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL)
  : null;
