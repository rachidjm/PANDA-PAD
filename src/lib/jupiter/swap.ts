import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { DEFAULT_SLIPPAGE_PCT, PANDA_FEE_BPS } from "@/lib/pump/constants";
import { feeTransferInstruction } from "@/lib/pump/fee-transfer";
import { getJupiterQuote, getJupiterSwapTransaction, SOL_MINT } from "./client";

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");

/**
 * Builds a real Jupiter-routed swap (any Solana DEX — Raydium, Orca,
 * Meteora, etc.) with PANDA's fee (0.5%) bundled into the same transaction,
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
  let feeLamports: BN;
  if (side === "sell") feeLamports = new BN(quote.outAmount).muln(PANDA_FEE_BPS).divn(10_000);
  else if (!payWithToken) feeLamports = new BN(amount).muln(PANDA_FEE_BPS).divn(10_000);
  else {
    let inSol: string;
    try {
      inSol = (await getJupiterQuote({ inputMint, outputMint: SOL_MINT, amount, slippageBps: Math.round(slippagePct * 100) })).outAmount;
    } catch {
      throw new Error("Can't value this token in SOL right now — pay with SOL instead.");
    }
    feeLamports = new BN(inSol).muln(PANDA_FEE_BPS).divn(10_000);
  }

  const feeIx = await feeTransferInstruction(connection, user, BigInt(feeLamports.toString()));
  if (feeIx) {
    if (side === "buy") {
      // Deducted up front, alongside the swap — insert right after any
      // leading compute-budget instructions, before the swap itself.
      let insertAt = 0;
      while (insertAt < message.instructions.length && message.instructions[insertAt].programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
        insertAt++;
      }
      message.instructions.splice(insertAt, 0, feeIx);
    } else {
      // Taken out of the proceeds, after the swap (and any WSOL-unwrap)
      // has already landed SOL in the user's wallet.
      message.instructions.push(feeIx);
    }
  }

  const newMessage = message.compileToV0Message(lookupTableAccounts);
  return new VersionedTransaction(newMessage);
}
