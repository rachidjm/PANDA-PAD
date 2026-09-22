import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { buildAmmSellTransaction, graduatedPoolFor } from "./amm-trade";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PRIORITY_FEE_MICRO_LAMPORTS } from "./constants";
import { tokenProgramOf } from "./token-program";
import { feeTransferInstruction } from "./fee-transfer";

/**
 * Builds a real, unsigned Pump.fun sell transaction. `tokenAmount` is in the
 * token's raw base units (its own decimals), not UI units — TradingPanel
 * converts before calling this.
 *
 * `poolAddress` is only set for a graduated coin — see buy.ts/amm-trade.ts.
 */
export async function buildSellTransaction({
  connection,
  mint,
  user,
  tokenAmount,
  poolAddress,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  tokenAmount: BN;
  poolAddress?: PublicKey;
  slippagePct?: number;
}): Promise<Transaction> {
  if (poolAddress) {
    return buildAmmSellTransaction({ connection, mint, user, poolAddress, tokenAmount, slippagePct });
  }

  const online = getOnlinePumpSdk(connection);
  const offline = getPumpSdk();

  const tokenProgram = await tokenProgramOf(connection, mint);
  const [global, feeConfig, sellState] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchSellState(mint, user, tokenProgram),
  ]);
  const { bondingCurveAccountInfo, bondingCurve } = sellState;

  // Finished its bonding curve: it trades on its PumpSwap pool now (see buy.ts).
  if (bondingCurve.complete) {
    return buildAmmSellTransaction({ connection, mint, user, poolAddress: graduatedPoolFor(mint), tokenAmount, slippagePct });
  }

  const solAmount = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: tokenAmount,
  });

  const instructions = await offline.sellInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    mint,
    user,
    amount: tokenAmount,
    solAmount,
    slippage: slippagePct,
    tokenProgram,
    mayhemMode: bondingCurve.isMayhemMode,
    cashback: bondingCurve.isCashbackCoin,
  });

  const feeLamports = solAmount.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
  tx.add(...instructions);
  const feeIx = await feeTransferInstruction(connection, user, BigInt(feeLamports.toString()));
  if (feeIx) tx.add(feeIx);
  return tx;
}
