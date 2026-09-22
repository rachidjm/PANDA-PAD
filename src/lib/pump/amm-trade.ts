import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_AMM_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { canonicalPumpPoolPda } from "@pump-fun/pump-swap-sdk";
import { getPumpAmmSdk, getOnlinePumpAmmSdk } from "./amm-client";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PRIORITY_FEE_MICRO_LAMPORTS } from "./constants";
import { feeTransferInstruction } from "./fee-transfer";
import { ammPoolProblem, poolOrientation, POOL_NOT_TRADABLE } from "./pool-check";

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

/** The PumpSwap pool a coin gets when it graduates from Pump.fun's bonding curve (a fixed address derived from the mint). */
export function graduatedPoolFor(mint: PublicKey): PublicKey {
  const pda = canonicalPumpPoolPda(mint) as PublicKey | [PublicKey, number];
  return Array.isArray(pda) ? pda[0] : pda;
}

async function assertRealPumpAmmPool(connection: Connection, poolAddress: PublicKey): Promise<void> {
  const info = await connection.getAccountInfo(poolAddress);
  if (!info) throw new Error("This coin's PumpSwap pool wasn't found on-chain yet — if it just graduated from Pump.fun, try again in a minute.");
  if (!info.owner.equals(PUMP_AMM_PROGRAM_ID)) {
    throw new Error("That address isn't a real PumpSwap pool account.");
  }
}

/** Refuses a pool that can't trade `mint` against SOL (inverted, another token's, or empty) BEFORE anything is built — the wallet would only pay a fee for a failure. */
function assertTradable(state: { pool: { baseMint: PublicKey; quoteMint: PublicKey }; poolBaseAmount: BN; poolQuoteAmount: BN }, mint: PublicKey) {
  const problem = ammPoolProblem(
    { baseMint: state.pool.baseMint.toBase58(), quoteMint: state.pool.quoteMint.toBase58(), baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount },
    mint.toBase58()
  );
  if (problem) throw new Error(`${POOL_NOT_TRADABLE}: ${problem}.`);
}

export async function buildAmmBuyTransaction({
  connection,
  mint,
  user,
  poolAddress,
  solAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  poolAddress: PublicKey;
  solAmount: number;
  slippagePct?: number;
}): Promise<Transaction> {
  await assertRealPumpAmmPool(connection, poolAddress);

  const online = getOnlinePumpAmmSdk(connection);
  const offline = getPumpAmmSdk();

  const state = await online.swapSolanaState(poolAddress, user);
  assertTradable(state, mint);

  const solAmountLamports = new BN(Math.round(solAmount * 1e9));
  // Buying the token = spending SOL. In a token/SOL pool SOL is the quote side, so that is a "buy"; in a SOL/token pool SOL is
  // the BASE side, so spending it is a "sell" of the base. Same trade, the other instruction.
  const instructions =
    poolOrientation({ baseMint: state.pool.baseMint.toBase58(), quoteMint: state.pool.quoteMint.toBase58() }, mint.toBase58()) === "token-quote"
      ? await offline.sellBaseInput(state, solAmountLamports, slippagePct)
      : await offline.buyQuoteInput(state, solAmountLamports, slippagePct);

  const feeLamports = solAmountLamports.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
  const feeIx = await feeTransferInstruction(connection, user, BigInt(feeLamports.toString()));
  if (feeIx) tx.add(feeIx);
  tx.add(...instructions);
  return tx;
}

export async function buildAmmSellTransaction({
  connection,
  mint,
  user,
  poolAddress,
  tokenAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  poolAddress: PublicKey;
  tokenAmount: BN;
  slippagePct?: number;
}): Promise<Transaction> {
  await assertRealPumpAmmPool(connection, poolAddress);

  const online = getOnlinePumpAmmSdk(connection);
  const offline = getPumpAmmSdk();

  const state = await online.swapSolanaState(poolAddress, user);
  assertTradable(state, mint);

  const inverted = poolOrientation({ baseMint: state.pool.baseMint.toBase58(), quoteMint: state.pool.quoteMint.toBase58() }, mint.toBase58()) === "token-quote";
  // Selling the token: in a token/SOL pool that is a "sell" of the base; in a SOL/token pool the token is the QUOTE side, so
  // it is a "buy" of the base (SOL) paid in tokens. That instruction limits what it may spend rather than what it must spend,
  // so a hair (0.1%) is left unsold: asking to spend a wallet's whole balance could come out one unit over it and fail.
  const instructions = inverted
    ? await offline.buyQuoteInput(state, tokenAmount.muln(999).divn(1000), slippagePct)
    : await offline.sellBaseInput(state, tokenAmount, slippagePct);

  // The exact SOL proceeds only settle on-chain (the pool's constant-product
  // price moves with the trade itself) — same "shown in your wallet before
  // you sign" honesty TradingPanel already states for a bonding-curve sell.
  // The PANDA fee here is taken from a real spot-price estimate off the
  // pool's current reserves, not a fabricated number, just an approximation
  // of what the precise on-chain proceeds will be.
  const [tokenReserve, solReserve] = inverted ? [state.poolQuoteAmount, state.poolBaseAmount] : [state.poolBaseAmount, state.poolQuoteAmount];
  const spotSolOut = tokenAmount.mul(solReserve).div(tokenReserve.add(tokenAmount));
  const feeLamports = spotSolOut.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
  tx.add(...instructions);
  const feeIx = await feeTransferInstruction(connection, user, BigInt(feeLamports.toString()));
  if (feeIx) tx.add(feeIx);
  return tx;
}
