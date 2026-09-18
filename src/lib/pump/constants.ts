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
