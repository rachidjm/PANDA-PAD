import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
} from "@solana/web3.js";
import bs58 from "bs58";
import { ORDER_CU_LIMIT, ORDER_CU_PRICE_MICRO_LAMPORTS } from "./math";

/**
 * The Solana side of PANDA orders, without any network I/O: nonce account addresses, the setup / close transactions'
 * instructions, the exact message of one order, and the check that what the wallet sends back is exactly what PANDA
 * built and was signed by that wallet.
 *
 * Nonce accounts are derived from the wallet itself (createAccountWithSeed, base = the wallet), so no extra keypair is
 * ever generated, stored or shown — and the wallet is their only authority: only the user can advance (cancel) or
 * close them. A sell and a stop of the same tranche are built on the SAME nonce: the first to land advances it and
 * the other can never execute.
 */

export const MAX_NONCE_INDEX = 64;
export const PACKET_LIMIT = 1232;

export const nonceSeed = (index: number) => `panda-nonce-${index}`;

export async function nonceAddress(wallet: PublicKey, index: number): Promise<PublicKey> {
  return PublicKey.createWithSeed(wallet, nonceSeed(index), SystemProgram.programId);
}

/** Instructions that create and initialise one nonce account per address, funded by and owned (authority) by the wallet. */
export function setupInstructions(wallet: PublicKey, accounts: { address: PublicKey; seed: string }[], rentLamports: number): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  for (const a of accounts) {
    out.push(
      SystemProgram.createAccountWithSeed({
        fromPubkey: wallet,
        newAccountPubkey: a.address,
        basePubkey: wallet,
        seed: a.seed,
        lamports: rentLamports,
        space: NONCE_ACCOUNT_LENGTH,
        programId: SystemProgram.programId,
      }),
      SystemProgram.nonceInitialize({ noncePubkey: a.address, authorizedPubkey: wallet })
    );
  }
  return out;
}

/** Closing a nonce account = withdrawing ALL of it back to the wallet: the deposit comes back and every order signed on
 *  that nonce becomes impossible to execute, in the same instruction. */
export function closeInstructions(wallet: PublicKey, accounts: { address: PublicKey; lamports: number }[]): TransactionInstruction[] {
  return accounts.map((a) => SystemProgram.nonceWithdraw({ noncePubkey: a.address, authorizedPubkey: wallet, toPubkey: wallet, lamports: a.lamports }));
}

export type ParsedNonce = { address: string; authority: string; nonce: string; lamports: number };

/** A live, initialised nonce account owned by the System program — anything else is null. */
export function parseNonce(address: string, info: AccountInfo<Buffer> | null): ParsedNonce | null {
  if (!info || !info.owner.equals(SystemProgram.programId) || info.data.length !== NONCE_ACCOUNT_LENGTH) return null;
  try {
    const n = NonceAccount.fromAccountData(info.data);
    return { address, authority: n.authorizedPubkey.toBase58(), nonce: n.nonce, lamports: info.lamports };
  } catch {
    return null;
  }
}

/** One order's unsigned transaction: AdvanceNonce FIRST (that is what makes it durable), the fixed compute budget, the
 *  sale, then PANDA's fee transfer(s). Fee payer and only signer: the wallet. */
export function orderTransaction(p: { wallet: PublicKey; nonceAccount: PublicKey; nonceValue: string; sale: TransactionInstruction[]; fee: TransactionInstruction[]; lookupTable?: AddressLookupTableAccount | null }): VersionedTransaction {
  const instructions = [
    SystemProgram.nonceAdvance({ noncePubkey: p.nonceAccount, authorizedPubkey: p.wallet }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: ORDER_CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ORDER_CU_PRICE_MICRO_LAMPORTS }),
    ...p.sale,
    ...p.fee,
  ];
  const message = new TransactionMessage({ payerKey: p.wallet, recentBlockhash: p.nonceValue, instructions }).compileToV0Message(p.lookupTable ? [p.lookupTable] : []);
  return new VersionedTransaction(message);
}

/** The transaction that VOIDS, on chain, every order signed on a nonce account: it only advances that nonce. It is itself
 *  durable (its "blockhash" is the nonce it advances), so it can't expire while the user reads their wallet, and it can
 *  land exactly once. Fee payer and only signer: the wallet. */
export function advanceTransaction(p: { wallet: PublicKey; nonceAccount: PublicKey; nonceValue: string }): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: p.wallet, recentBlockhash: p.nonceValue, instructions: [SystemProgram.nonceAdvance({ noncePubkey: p.nonceAccount, authorizedPubkey: p.wallet })] }).compileToV0Message();
  return new VersionedTransaction(message);
}

export const messageHash = (message: Uint8Array) => createHash("sha256").update(message).digest("hex");

export type VerifyResult = { ok: true; bytes: Uint8Array; signature: string } | { ok: false; reason: "unreadable" | "modified" | "wrong_signer" | "bad_signature" };

/**
 * What the wallet sent back must be EXACTLY the message PANDA built (same hash: not one instruction added, removed or
 * changed — a wallet that rewrites transactions is refused, never stored), with one signer, that signer the session's
 * wallet, and a valid ed25519 signature over those bytes.
 */
export function verifySignedOrder(signedBase64: unknown, expected: { wallet: string; messageHash: string }): VerifyResult {
  let tx: VersionedTransaction;
  try {
    if (typeof signedBase64 !== "string" || signedBase64.length > 4000) return { ok: false, reason: "unreadable" };
    tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const message = tx.message.serialize();
  if (messageHash(message) !== expected.messageHash) return { ok: false, reason: "modified" };
  const keys = tx.message.staticAccountKeys;
  if (tx.message.header.numRequiredSignatures !== 1 || !keys[0] || keys[0].toBase58() !== expected.wallet) return { ok: false, reason: "wrong_signer" };
  const sig = tx.signatures[0];
  if (!sig || sig.every((b) => b === 0)) return { ok: false, reason: "bad_signature" };
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(keys[0].toBytes()).toString("base64url") }, format: "jwk" });
    if (!edVerify(null, Buffer.from(message), key, Buffer.from(sig))) return { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, bytes: tx.serialize(), signature: bs58.encode(sig) };
}
