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
import { Connection } from "@solana/web3.js";
import { PumpSdk, OnlinePumpSdk } from "@pump-fun/pump-sdk";

export function getPumpSdk(): PumpSdk {
  return new PumpSdk();
}

export function getOnlinePumpSdk(connection: Connection): OnlinePumpSdk {
  return new OnlinePumpSdk(connection);
}
