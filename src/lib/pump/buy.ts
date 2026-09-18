import { Connection, PublicKey, Transaction, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { getPumpSdk, getOnlinePumpSdk } from "./client";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS, PANDA_TREASURY } from "./constants";

/**
 * Builds a real, unsigned Pump.fun buy transaction for an existing bonding
 * curve. The caller (TradingPanel) sets the fee payer / blockhash and sends
 * it through the connected wallet — this module never signs or submits
 * anything itself.
 */
export async function buildBuyTransaction({
  connection,
  mint,
  user,
  solAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  solAmount: number;
  slippagePct?: number;
}): Promise<Transaction> {
  const online = getOnlinePumpSdk(connection);
  const offline = getPumpSdk();

  const [global, feeConfig, buyState] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    online.fetchBuyState(mint, user),
  ]);
  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo, quoteMint } = buyState;

  if (bondingCurve.complete) {
    throw new Error("This coin has graduated off the bonding curve — trade it on PumpSwap instead.");
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
    tokenProgram: TOKEN_PROGRAM_ID,
  });

  const feeLamports = solAmountLamports.muln(PANDA_FEE_BPS).divn(10_000);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  if (feeLamports.gtn(0)) {
    tx.add(SystemProgram.transfer({ fromPubkey: user, toPubkey: PANDA_TREASURY, lamports: BigInt(feeLamports.toString()) }));
  }
  tx.add(...instructions);
  return tx;
}
