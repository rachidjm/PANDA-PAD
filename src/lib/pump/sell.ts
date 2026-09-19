import { Connection, PublicKey, Transaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { buildAmmSellTransaction } from "./amm-trade";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PANDA_TREASURY } from "./constants";

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
    return buildAmmSellTransaction({ connection, user, poolAddress, tokenAmount, slippagePct });
  }

  const online = getOnlinePumpSdk(connection);
  const offline = getPumpSdk();

  const [global, feeConfig, sellState] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchSellState(mint, user),
  ]);
  const { bondingCurveAccountInfo, bondingCurve } = sellState;

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
    tokenProgram: TOKEN_PROGRAM_ID,
    mayhemMode: bondingCurve.isMayhemMode,
  });

  const feeLamports = solAmount.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(...instructions);
  if (feeLamports.gtn(0)) {
    tx.add(SystemProgram.transfer({ fromPubkey: user, toPubkey: PANDA_TREASURY, lamports: BigInt(feeLamports.toString()) }));
  }
  return tx;
}
