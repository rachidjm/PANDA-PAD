import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { createBurnCheckedInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Db } from "@/lib/db/client";
import { pgBurnBalances, pgOpenBurnTxs, pgRecordBurnTx, pgSettleBurnTx } from "@/lib/db/burn";
import { getJupiterQuote, getJupiterSwapTransaction, SOL_MINT } from "@/lib/jupiter/client";
import { buildBuyTransaction } from "@/lib/pump/buy";
import { DEFAULT_SLIPPAGE_PCT } from "@/lib/pump/constants";
import { PRIORITY_FEE_MICRO_LAMPORTS } from "@/lib/pump/constants";
import { tokenProgramOf } from "@/lib/pump/token-program";
import { confirmSignature } from "@/lib/solana/confirm";
import { BURN_RESERVE_LAMPORTS, burnSpendLamports } from "./config";

/**
 * Buying a coin with its own Burn share and burning what was bought.
 *
 * Two transactions per round, both signed by the burn wallet and both SIMULATED before they are sent:
 *   1. buy — the coin's ordinary Pump.fun / PumpSwap buy (or, for a coin whose pool isn't paired with SOL, the same
 *      swap routed by Jupiter), for the SOL the ledger says that coin has pending (never more: one coin's burn can't
 *      spend another's), with no PANDA trade fee on it;
 *   2. burn — the token program's own `BurnChecked` for EVERYTHING the wallet holds of that coin, then the empty token
 *      account is closed (its rent comes back). The tokens stop existing; nothing is sent anywhere.
 * The wallet holds a coin only between those two. If a round stops in between, the next one finds the coin still in the
 * wallet and burns it first — so whatever was bought is always burned, without the ledger having to remember it.
 *
 * Every transaction is written to the ledger BEFORE it is sent (with the most it can cost) and settled afterwards from
 * what the chain says it really cost. A transaction that was sent and whose answer never came is settled on a later
 * round (resolveOpenBurnTxs), again from the chain.
 */

export type BurnOutcome = { mint: string; bought?: { signature: string; lamports: number }; burned?: { signature: string; tokens: string; decimals: number }; skipped?: string; error?: string };

/** The burn itself: `BurnChecked` on the coin's own token program (classic or Token-2022), and the empty account closed. Nothing else. */
export function burnInstructions(i: { owner: PublicKey; mint: PublicKey; tokenProgram: PublicKey; amount: bigint; decimals: number; close: boolean }): TransactionInstruction[] {
  const account = getAssociatedTokenAddressSync(i.mint, i.owner, false, i.tokenProgram);
  const out = [createBurnCheckedInstruction(account, i.mint, i.owner, i.amount, i.decimals, [], i.tokenProgram)];
  if (i.close) out.push(createCloseAccountInstruction(account, i.owner, i.owner, [], i.tokenProgram));
  return out;
}

/** What a confirmed transaction really cost its fee payer (the burn wallet): can be negative when rent came back. Null if it can't be read yet. */
async function costOf(connection: Connection, signature: string): Promise<{ lamports: number; failed: boolean } | null> {
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx?.meta) return null;
  return { lamports: tx.meta.preBalances[0] - tx.meta.postBalances[0], failed: !!tx.meta.err };
}

const OPEN_TX_GIVE_UP_MS = 5 * 60_000;

/** Transactions that were sent and never settled (the function was cut off, the RPC didn't answer): settled now, from the chain. */
export async function resolveOpenBurnTxs(connection: Connection, db: Db, now: number = Date.now()): Promise<number> {
  let resolved = 0;
  for (const row of await pgOpenBurnTxs(db)) {
    const cost = await costOf(connection, row.signature).catch(() => null);
    if (cost) {
      await pgSettleBurnTx(db, row.signature, cost.failed ? { status: "failed" } : { status: "confirmed", lamports: cost.lamports });
      resolved++;
    } else if (now - row.createdAt.getTime() > OPEN_TX_GIVE_UP_MS) {
      // Its blockhash expired long ago and the chain has no trace of it: it never landed, nothing was spent.
      await pgSettleBurnTx(db, row.signature, { status: "failed" });
      resolved++;
    }
  }
  return resolved;
}

type AnyTx = Transaction | VersionedTransaction;

/**
 * The buy: Pump.fun's curve or the coin's PumpSwap pool against SOL — the coin's own market. A graduated coin whose pool
 * is paired with something other than SOL can't be bought that way; Jupiter routes the same SOL → coin swap for it.
 * Neither carries a PANDA fee. Building a transaction sends nothing: whichever is used is simulated and recorded first.
 */
export async function buildBurnBuy(connection: Connection, wallet: PublicKey, mint: PublicKey, lamports: number): Promise<AnyTx> {
  try {
    return await buildBuyTransaction({ connection, mint, user: wallet, solAmount: lamports / 1e9, platformFee: false });
  } catch (direct) {
    try {
      const quote = await getJupiterQuote({ inputMint: SOL_MINT, outputMint: mint.toBase58(), amount: String(lamports), slippageBps: Math.round(DEFAULT_SLIPPAGE_PCT * 100) });
      const base64 = await getJupiterSwapTransaction({ quote, userPublicKey: wallet.toBase58() });
      return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    } catch (routed) {
      const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);
      throw new Error(`this coin can't be bought right now (${why(direct)} / ${why(routed)})`);
    }
  }
}

async function sendChecked(connection: Connection, signer: Keypair, tx: AnyTx, record: (signature: string) => Promise<void>, db: Db): Promise<{ signature: string; lamports: number }> {
  let signature: string;
  let raw: Uint8Array;
  let err: unknown;
  if (tx instanceof VersionedTransaction) {
    tx.sign([signer]);
    signature = bs58.encode(tx.signatures[0]);
    // Simulated first: a transaction that would fail is never sent (and costs nothing).
    err = (await connection.simulateTransaction(tx, { sigVerify: true })).value.err;
    raw = tx.serialize();
  } else {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(signer);
    signature = bs58.encode(tx.signature!);
    err = (await connection.simulateTransaction(tx)).value.err;
    raw = tx.serialize();
  }
  if (err) throw new Error(`simulation failed: ${JSON.stringify(err)}`);
  await record(signature);
  try {
    await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    await confirmSignature(connection, signature);
  } catch (sendErr) {
    // Sent or not, confirmed or not: the chain decides. A transaction it knows is settled as it ended; one it doesn't stays "sent" for the next round.
    const cost = await costOf(connection, signature).catch(() => null);
    if (cost) await pgSettleBurnTx(db, signature, cost.failed ? { status: "failed" } : { status: "confirmed", lamports: cost.lamports });
    if (!cost || cost.failed) throw sendErr;
    return { signature, lamports: cost.lamports };
  }
  const cost = await costOf(connection, signature).catch(() => null);
  if (cost) await pgSettleBurnTx(db, signature, cost.failed ? { status: "failed" } : { status: "confirmed", lamports: cost.lamports });
  if (cost?.failed) throw new Error("transaction failed on chain");
  return { signature, lamports: cost?.lamports ?? 0 };
}

/** Burns everything the wallet holds of a coin. Null when it holds none. */
export async function burnHeld(connection: Connection, db: Db, signer: Keypair, mint: PublicKey): Promise<{ signature: string; tokens: string; decimals: number } | null> {
  const tokenProgram = await tokenProgramOf(connection, mint);
  const account = getAssociatedTokenAddressSync(mint, signer.publicKey, false, tokenProgram);
  const balance = await connection.getTokenAccountBalance(account, "confirmed").catch(() => null);
  if (!balance) return null; // no token account: nothing was ever bought, or it was burned and closed
  const amount = BigInt(balance.value.amount);
  const decimals = balance.value.decimals;
  const build = (close: boolean) => {
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }));
    if (amount > BigInt(0)) tx.add(...burnInstructions({ owner: signer.publicKey, mint, tokenProgram, amount, decimals, close }));
    else tx.add(createCloseAccountInstruction(account, signer.publicKey, signer.publicKey, [], tokenProgram));
    return tx;
  };
  if (amount === BigInt(0)) {
    // An empty account left open: closed, so its rent comes back. Not a burn — nothing is recorded as one.
    await sendChecked(connection, signer, build(true), async () => undefined, db).catch(() => undefined);
    return null;
  }
  const record = (signature: string) => pgRecordBurnTx(db, { signature, mint: mint.toBase58(), kind: "burn", reservedLamports: 100_000, tokens: amount.toString(), decimals });
  try {
    const sent = await sendChecked(connection, signer, build(true), record, db);
    return { signature: sent.signature, tokens: amount.toString(), decimals };
  } catch (err) {
    // Some token accounts can't be closed (a token with extensions that hold something back): the burn alone, then.
    if (!/simulation failed/.test(err instanceof Error ? err.message : "")) throw err;
    const sent = await sendChecked(connection, signer, build(false), record, db);
    return { signature: sent.signature, tokens: amount.toString(), decimals };
  }
}

/** One coin's round: burn anything still held, then — if its Burn share has gathered enough — buy and burn again. */
export async function runBurnForMint(connection: Connection, db: Db, signer: Keypair, mint: string, minLamports: number): Promise<BurnOutcome> {
  const out: BurnOutcome = { mint };
  const key = new PublicKey(mint);
  try {
    const leftover = await burnHeld(connection, db, signer, key);
    if (leftover) out.burned = leftover;

    const [balance] = await pgBurnBalances(db, mint);
    const spend = burnSpendLamports(balance?.pendingLamports ?? 0, minLamports);
    if (spend <= 0) {
      if (!out.burned) out.skipped = "below_minimum";
      return out;
    }
    // Never more than the wallet really has (the ledger and the chain agree unless someone moved SOL by hand).
    const held = await connection.getBalance(signer.publicKey, "confirmed");
    if (held < spend + BURN_RESERVE_LAMPORTS) {
      out.skipped = "wallet_short";
      return out;
    }
    const tx = await buildBurnBuy(connection, signer.publicKey, key, spend);
    const bought = await sendChecked(connection, signer, tx, (signature) => pgRecordBurnTx(db, { signature, mint, kind: "buy", reservedLamports: spend + BURN_RESERVE_LAMPORTS }), db);
    out.bought = bought;
    const burned = await burnHeld(connection, db, signer, key);
    if (burned) out.burned = burned;
  } catch (err) {
    out.error = err instanceof Error ? err.message.slice(0, 300) : "error";
  }
  return out;
}
