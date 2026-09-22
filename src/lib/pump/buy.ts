import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { buildAmmBuyTransaction, graduatedPoolFor } from "./amm-trade";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PRIORITY_FEE_MICRO_LAMPORTS } from "./constants";
import { tokenProgramOf } from "./token-program";
import { feeTransferInstruction } from "./fee-transfer";

/**
 * Builds a real, unsigned Pump.fun buy transaction. The caller (TradingPanel)
 * sets the fee payer / blockhash and sends it through the connected wallet —
 * this module never signs or submits anything itself.
 *
 * `poolAddress` is only set for a graduated coin (TradingPanel already knows
 * `coin.source === "pumpswap"` and `coin.poolAddress` from the same data
 * live-coins.ts already fetched) and routes straight to the real PumpSwap
 * builder — see amm-trade.ts for why the pool isn't re-derived here.
 */
export async function buildBuyTransaction({
  connection,
  mint,
  user,
  solAmount,
  poolAddress,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  solAmount: number;
  poolAddress?: PublicKey;
  slippagePct?: number;
}): Promise<Transaction> {
  if (poolAddress) {
    return buildAmmBuyTransaction({ connection, mint, user, poolAddress, solAmount, slippagePct });
  }

  const online = getOnlinePumpSdk(connection);
  const offline = getPumpSdk();

  // Pump.fun's coins are Token-2022 now (older ones classic SPL): every account of the trade has to use the coin's own program.
  const tokenProgram = await tokenProgramOf(connection, mint);
  const [global, feeConfig, buyState] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchBuyState(mint, user, tokenProgram),
  ]);
  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo, quoteMint } = buyState;

  // A coin that has finished its bonding curve can't be bought there any more ("BondingCurveComplete"): it trades on its PumpSwap pool.
  // The coin lists lag behind this, so the curve itself decides.
  if (bondingCurve.complete) {
    return buildAmmBuyTransaction({ connection, mint, user, poolAddress: graduatedPoolFor(mint), solAmount, slippagePct });
  }

  const solAmountLamports = new BN(Math.round(solAmount * 1e9));
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solAmountLamports,
    quoteMint,
  });

  const instructions = await offline.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount: tokenAmount,
    solAmount: solAmountLamports,
    slippage: slippagePct,
    tokenProgram,
  });

  const feeLamports = solAmountLamports.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
  const feeIx = await feeTransferInstruction(connection, user, BigInt(feeLamports.toString()));
  if (feeIx) tx.add(feeIx);
  tx.add(...instructions);
  return tx;
}
