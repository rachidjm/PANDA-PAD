import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { DEFAULT_SLIPPAGE_PCT } from "@/lib/pump/constants";
import { feeTransferInstructions } from "@/lib/pump/fee-transfer";
import { feeBpsForWallet } from "@/lib/pump/fee-tier";
import { getJupiterQuote, getJupiterSwapTransaction, SOL_MINT } from "./client";

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");

/**
 * Builds a real Jupiter-routed swap (any Solana DEX — Raydium, Orca,
 * Meteora, etc.) with PANDA's fee bundled into the same transaction,
 * the same way the Pump.fun buy/sell builders do it. Jupiter returns a
 * versioned transaction with its own address lookup tables, so the fee
 * instruction has to be spliced into the decompiled message rather than
 * just appended to a legacy Transaction.
 */
export async function buildJupiterSwapTransaction({
  connection,
  mint,
  user,
  side,
  solAmount,
  tokenAmount,
  payMint,
  payAmount,
  slippagePct = DEFAULT_SLIPPAGE_PCT,
}: {
  connection: Connection;
  mint: PublicKey;
  user: PublicKey;
  side: "buy" | "sell";
  solAmount?: number;
  tokenAmount?: string;
  /** A buy paid with a token from the wallet instead of SOL: its mint and the amount in its base units. */
  payMint?: PublicKey;
  payAmount?: string;
  slippagePct?: number;
}): Promise<VersionedTransaction> {
  const payWithToken = side === "buy" && !!payMint && payMint.toBase58() !== SOL_MINT;
  const inputMint = side === "buy" ? (payWithToken ? payMint!.toBase58() : SOL_MINT) : mint.toBase58();
  const outputMint = side === "buy" ? mint.toBase58() : SOL_MINT;
  const amount =
    side === "buy"
      ? payWithToken
        ? String(payAmount || "0")
        : String(Math.round((solAmount || 0) * 1e9))
      : String(tokenAmount || "0");

  if (amount === "0") throw new Error("Missing trade amount.");
  if (payWithToken && payMint!.toBase58() === mint.toBase58()) throw new Error("Can't pay for a coin with itself.");

  const quote = await getJupiterQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps: Math.round(slippagePct * 100),
  });

  const swapTransactionBase64 = await getJupiterSwapTransaction({ quote, userPublicKey: user.toBase58() });
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransactionBase64, "base64"));

  const lookupTableAccounts: AddressLookupTableAccount[] = [];
  for (const lookup of tx.message.addressTableLookups) {
    const account = await connection.getAddressLookupTable(lookup.accountKey).then((res) => res.value);
    if (account) lookupTableAccounts.push(account);
  }

  const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookupTableAccounts });

  // PANDA's fee is always a plain SOL transfer. Paid with SOL it is a share of the amount; paid with a token it is
  // a share of what that token is worth in SOL right now (Jupiter's own quote of it), still added on top.
  const feeBps = await feeBpsForWallet(user.toBase58());
  let feeLamports: BN;
  if (side === "sell") feeLamports = new BN(quote.outAmount).muln(feeBps).divn(10_000);
  else if (!payWithToken) feeLamports = new BN(amount).muln(feeBps).divn(10_000);
  else {
    let inSol: string;
    try {
      inSol = (await getJupiterQuote({ inputMint, outputMint: SOL_MINT, amount, slippageBps: Math.round(slippagePct * 100) })).outAmount;
    } catch {
      throw new Error("Can't value this token in SOL right now — pay with SOL instead.");
    }
    feeLamports = new BN(inSol).muln(feeBps).divn(10_000);
  }

  const feeIxs = await feeTransferInstructions(connection, user, BigInt(feeLamports.toString()));
  if (feeIxs.length) {
    if (side === "buy") {
      // Deducted up front, alongside the swap — insert right after any
      // leading compute-budget instructions, before the swap itself.
      let insertAt = 0;
      while (insertAt < message.instructions.length && message.instructions[insertAt].programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
        insertAt++;
      }
      message.instructions.splice(insertAt, 0, ...feeIxs);
    } else {
      // Taken out of the proceeds, after the swap (and any WSOL-unwrap)
      // has already landed SOL in the user's wallet.
      message.instructions.push(...feeIxs);
    }
  }

  const newMessage = message.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMessage);
}

/** How much more than the bare figure a conversion sells, to absorb the route's spread and slippage: +3%, then +8%. */
export const CONVERT_MARGINS_BPS = [300, 800] as const;
export const CONVERT_SLIPPAGE_BPS = 100;
/** The most a single conversion may be asked to produce (1,000 SOL): a typo guard, not a business rule. */
export const MAX_CONVERT_LAMPORTS = BigInt(1_000) * BigInt(1_000_000_000);

/** Pure: the token amount to sell for a quote that says `tokens` are worth the SOL needed, with a margin on top. */
export function withMargin(tokens: bigint, marginBps: number): bigint {
  return (tokens * BigInt(10_000 + marginBps)) / BigInt(10_000) + BigInt(1);
}

/**
 * Converts a token of the wallet into SOL, so a Draw Your Trade buy order can be paid with any coin: the swap goes in
 * the same signing batch as the order's deposit and is sent first. It sells just enough for the swap's guaranteed
 * minimum (after slippage) to cover `lamports`; if no route guarantees that, nothing is built. No PANDA fee here: the
 * order's own fee is the same whatever it is paid with.
 */
export async function buildConvertToSolTransaction({ user, payMint, lamports }: { user: PublicKey; payMint: PublicKey; lamports: bigint }): Promise<{ transaction: VersionedTransaction; inAmount: string; minOutLamports: string }> {
  const input = payMint.toBase58();
  if (input === SOL_MINT) throw new Error("SOL needs no conversion.");
  if (lamports <= BigInt(0) || lamports > MAX_CONVERT_LAMPORTS) throw new Error("Invalid amount to convert.");
  // What the SOL needed costs in this token, read the other way round (SOL -> token)…
  const reverse = await getJupiterQuote({ inputMint: SOL_MINT, outputMint: input, amount: lamports.toString(), slippageBps: CONVERT_SLIPPAGE_BPS });
  const tokens = BigInt(reverse.outAmount);
  if (tokens <= BigInt(0)) throw new Error("No route found for this trade.");
  // …then sold with a margin until the guaranteed minimum covers it.
  for (const margin of CONVERT_MARGINS_BPS) {
    const quote = await getJupiterQuote({ inputMint: input, outputMint: SOL_MINT, amount: withMargin(tokens, margin).toString(), slippageBps: CONVERT_SLIPPAGE_BPS });
    if (BigInt(quote.otherAmountThreshold) < lamports) continue;
    const base64 = await getJupiterSwapTransaction({ quote, userPublicKey: user.toBase58(), dynamicSlippage: false });
    return { transaction: VersionedTransaction.deserialize(Buffer.from(base64, "base64")), inAmount: quote.inAmount, minOutLamports: quote.otherAmountThreshold };
  }
  throw new Error("This coin can't be converted to SOL at a fair price right now — pay with SOL or USDC instead.");
}
