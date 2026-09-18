import { PublicKey } from "@solana/web3.js";

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
export const PANDA_FEE_BPS = 100; // 1%

export const PANDA_TREASURY = new PublicKey(
  process.env.NEXT_PUBLIC_PANDA_TREASURY || "GJvaNLciu58gCyJap2tzGam76SS1w2Bg9bHbfKyzxb8m"
);

/**
 * Where a coin's "Holders" creator-fee share lands, when a creator opts into
 * Fee Distribution — a real Solana address, public key only. PANDA never
 * holds this wallet's private key in the frontend/repo; the server-side
 * signer needed to actually pay individual holders out of it is separate,
 * operational infrastructure that isn't wired up yet (see RewardsDashboard's
 * "coming soon" claim state). `null` when unset, so callers can render an
 * honest "not configured" state instead of a fake address.
 */
export const PANDA_REWARDS_POOL = process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL
  ? new PublicKey(process.env.NEXT_PUBLIC_PANDA_REWARDS_POOL)
  : null;
