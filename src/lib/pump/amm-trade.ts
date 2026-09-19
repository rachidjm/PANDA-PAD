import { Connection, PublicKey, Transaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_AMM_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { getPumpAmmSdk, getOnlinePumpAmmSdk } from "./amm-client";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PANDA_TREASURY } from "./constants";

/**
 * Real trading for a coin that's graduated off the bonding curve onto
 * PumpSwap (Pump.fun's AMM) — `@pump-fun/pump-swap-sdk`, the official,
 * separate package for it (the bonding-curve `@pump-fun/pump-sdk` only
 * covers the pre-graduation program; `buy.ts`/`sell.ts` in this folder
 * delegate here for a graduated coin).
 *
 * `poolAddress` is the coin's real, on-chain-verified pool (the same one
 * `live-coins.ts` already gets from GeckoTerminal and shows everywhere else
 * in the app) — not re-derived here. A migrated coin's pool isn't always at
 * the "canonical" PDA `canonicalPumpPoolPda(mint)` would compute (confirmed
 * by testing against a real graduated coin whose actual on-chain pool, real
 * and PumpAmm-program-owned, didn't match that derivation — likely coins
 * that migrated through a non-default path), so trusting the address this
 * app already has and verifying it on-chain here is more honest than
 * guessing a formula.
 */

async function assertRealPumpAmmPool(connection: Connection, poolAddress: PublicKey): Promise<void> {
  const info = await connection.getAccountInfo(poolAddress);
  if (!info) throw new Error("This coin's PumpSwap pool wasn't found on-chain.");
  if (!info.owner.equals(PUMP_AMM_PROGRAM_ID)) {
    throw new Error("That address isn't a real PumpSwap pool account.");
  }
}

export async function buildAmmBuyTransaction({
  connection,
  user,
  poolAddress,
  solAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  user: PublicKey;
  poolAddress: PublicKey;
  solAmount: number;
  slippagePct?: number;
}): Promise<Transaction> {
  await assertRealPumpAmmPool(connection, poolAddress);

  const online = getOnlinePumpAmmSdk(connection);
  const offline = getPumpAmmSdk();

  const state = await online.swapSolanaState(poolAddress, user);

  const solAmountLamports = new BN(Math.round(solAmount * 1e9));
  const instructions = await offline.buyQuoteInput(state, solAmountLamports, slippagePct);

  const feeLamports = solAmountLamports.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  if (feeLamports.gtn(0)) {
    tx.add(SystemProgram.transfer({ fromPubkey: user, toPubkey: PANDA_TREASURY, lamports: BigInt(feeLamports.toString()) }));
  }
  tx.add(...instructions);
  return tx;
}

export async function buildAmmSellTransaction({
  connection,
  user,
  poolAddress,
  tokenAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  user: PublicKey;
  poolAddress: PublicKey;
  tokenAmount: BN;
  slippagePct?: number;
}): Promise<Transaction> {
  await assertRealPumpAmmPool(connection, poolAddress);

  const online = getOnlinePumpAmmSdk(connection);
  const offline = getPumpAmmSdk();

  const state = await online.swapSolanaState(poolAddress, user);

  const instructions = await offline.sellBaseInput(state, tokenAmount, slippagePct);

  // The exact SOL proceeds only settle on-chain (the pool's constant-product
  // price moves with the trade itself) — same "shown in your wallet before
  // you sign" honesty TradingPanel already states for a bonding-curve sell.
  // The PANDA fee here is taken from a real spot-price estimate off the
  // pool's current reserves, not a fabricated number, just an approximation
  // of what the precise on-chain proceeds will be.
  const spotSolOut = tokenAmount.mul(state.poolQuoteAmount).div(state.poolBaseAmount.add(tokenAmount));
  const feeLamports = spotSolOut.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(...instructions);
  if (feeLamports.gtn(0)) {
    tx.add(SystemProgram.transfer({ fromPubkey: user, toPubkey: PANDA_TREASURY, lamports: BigInt(feeLamports.toString()) }));
  }
  return tx;
}
