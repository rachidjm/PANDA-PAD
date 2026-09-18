/**
 * Thin wrappers around the official Pump.fun SDK (`@pump-fun/pump-sdk`).
 *
 * The package ships two classes:
 * - `OnlinePumpSdk(connection)` — reads on-chain state (Global, FeeConfig,
 *   a mint's bonding curve, ...).
 * - `PumpSdk()` — pure instruction builders that take that state as input.
 *
 * Every Pump-specific import in the app should go through this folder, not
 * be scattered across components, so the integration can be updated in one
 * place if Pump changes its programs or SDK.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { PumpSdk, OnlinePumpSdk } from "@pump-fun/pump-sdk";

export function getPumpSdk(): PumpSdk {
  return new PumpSdk();
}

export function getOnlinePumpSdk(connection: Connection): OnlinePumpSdk {
  return new OnlinePumpSdk(connection);
}

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
