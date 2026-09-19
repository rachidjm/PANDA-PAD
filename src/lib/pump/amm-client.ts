/**
 * Thin wrappers around the official PumpSwap SDK (`@pump-fun/pump-swap-sdk`)
 * — the separate, official package for trading on Pump.fun's AMM, which a
 * coin moves to once its bonding curve graduates. Same online/offline split
 * as `client.ts`'s wrapper around `@pump-fun/pump-sdk` (the bonding-curve
 * program): `OnlinePumpAmmSdk(connection)` reads real pool/account state,
 * `PumpAmmSdk()` is pure instruction builders over that state.
 */
import { Connection } from "@solana/web3.js";
import { PumpAmmSdk, OnlinePumpAmmSdk } from "@pump-fun/pump-swap-sdk";

export function getPumpAmmSdk(): PumpAmmSdk {
  return new PumpAmmSdk();
}

export function getOnlinePumpAmmSdk(connection: Connection): OnlinePumpAmmSdk {
  return new OnlinePumpAmmSdk(connection);
}
