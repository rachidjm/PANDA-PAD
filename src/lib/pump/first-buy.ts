import { ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { feeSharingConfigPda, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { getOnlinePumpSdk, getPumpSdk } from "./client";
import { DEFAULT_SLIPPAGE_PCT, PRIORITY_FEE_MICRO_LAMPORTS } from "./constants";
import { feeBpsForWallet } from "./fee-tier";
import { feeTransferInstructions } from "./fee-transfer";

/**
 * The creator's first buy, built BEFORE the coin exists — so the wallet can approve the launch and this buy in one go
 * (signAllTransactions) and PANDA sends them one after the other.
 *
 * Why two transactions and not one: creating the coin, its fee split and a buy together is 1,420–1,550 bytes even with
 * every fixed account in a lookup table, against Solana's 1,232 (measured against mainnet's programs). The coin's own
 * accounts — a different set for every launch — are what doesn't fit.
 *
 * A buy needs the curve's state, and there is none yet. But a new curve always starts from Pump.fun's Global account, so
 * the SDK's own create-and-buy builder gives the very buy that follows a creation; its creation half is dropped here
 * (the launch transaction does that, with the fee split). Two things are particular to a PANDA launch:
 *   - the fee split makes the coin's SharingConfig the curve's creator, so the buy must pay creator fees into THAT vault
 *     (checked against a real PANDA launch's first buy: the same 18 accounts);
 *   - someone can buy between the two transactions, moving the price. The SDK allows 1% over the quoted cost; this
 *     widens it to PANDA's usual slippage. Past that the buy fails — it is simulated right before it is sent, so a buy
 *     that would fail is never sent, and the creator is offered a fresh one.
 * PANDA's trade fee is added exactly as on any buy (src/lib/pump/buy.ts).
 */

const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Offsets in the legacy `buy` instruction's data: 8-byte discriminator, u64 token amount, u64 max SOL cost. */
const AMOUNT_AT = 8;
const MAX_COST_AT = 16;

/**
 * Raises a buy's "at most this much SOL" to `solLamports` plus the slippage. Refuses (throws) if the instruction isn't
 * shaped as expected — an SDK that changed its layout must never be patched blindly.
 */
export function widenMaxCost(buy: TransactionInstruction, tokenAmount: bigint, solLamports: bigint, slippagePct: number): TransactionInstruction {
  const data = Buffer.from(buy.data);
  if (data.length < MAX_COST_AT + 8) throw new Error("first buy: unexpected instruction data");
  const quoted = data.readBigUInt64LE(MAX_COST_AT);
  // The SDK's own figure: the amount asked for, and the cost with its small margin (never less than the cost, never over 1.1x).
  if (data.readBigUInt64LE(AMOUNT_AT) !== tokenAmount || quoted < solLamports || quoted > (solLamports * BigInt(11)) / BigInt(10)) throw new Error("first buy: unexpected instruction layout");
  const widened = (solLamports * BigInt(Math.round((100 + slippagePct) * 100))) / BigInt(10_000);
  if (widened > quoted) data.writeBigUInt64LE(widened, MAX_COST_AT);
  return new TransactionInstruction({ programId: buy.programId, keys: buy.keys, data });
}

/** The instructions of that buy: the creator's token account and the buy itself. Offline given Pump.fun's Global. */
export async function firstBuyInstructions({
  global,
  feeConfig,
  mint,
  user,
  solLamports,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  global: Parameters<typeof getBuyTokenAmountFromSolAmount>[0]["global"];
  feeConfig: Parameters<typeof getBuyTokenAmountFromSolAmount>[0]["feeConfig"];
  mint: PublicKey;
  user: PublicKey;
  solLamports: bigint;
  slippagePct?: number;
}): Promise<TransactionInstruction[]> {
  const sol = new BN(solLamports.toString());
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: sol, quoteMint: SOL_MINT });
  if (amount.lten(0)) throw new Error("first buy: the amount is too small to buy anything");
  const built = await getPumpSdk().createV2AndBuyInstructions({
    global,
    mint,
    // Dropped below with the creation itself; only the buy's accounts matter here.
    name: "-",
    symbol: "-",
    uri: "-",
    // After a PANDA launch the curve's creator is the coin's fee SharingConfig (see above).
    creator: feeSharingConfigPda(mint),
    user,
    amount,
    solAmount: sol,
    mayhemMode: false,
  });
  // [create, the user's token account, buy]: everything after the creation.
  if (built.length < 3) throw new Error("first buy: unexpected instructions");
  const rest = built.slice(1);
  const buy = rest[rest.length - 1];
  return [...rest.slice(0, -1), widenMaxCost(buy, BigInt(amount.toString()), solLamports, slippagePct)];
}

/** The whole first-buy transaction (v0, no lookup table), unsigned. Nothing is sent here. */
export async function buildFirstBuyTransaction({
  connection,
  mint,
  user,
  solAmount,
  blockhash,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  solAmount: number;
  blockhash: string;
}): Promise<VersionedTransaction> {
  const online = getOnlinePumpSdk(connection);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  const solLamports = BigInt(Math.round(solAmount * 1e9));
  const instructions = await firstBuyInstructions({ global, feeConfig, mint, user, solLamports });
  const feeBps = await feeBpsForWallet(user.toBase58());
  const feeLamports = (solLamports * BigInt(feeBps)) / BigInt(10_000);
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }),
      ...(await feeTransferInstructions(connection, user, feeLamports)),
      ...instructions,
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}
