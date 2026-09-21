import { PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";

/**
 * The fee is a plain SOL transfer from the user's wallet to PANDA's treasury, in its own transaction that the wallet
 * signs together with the deposit to Jupiter. The server builds it, and before sending anything it checks the signed
 * copy that comes back: exactly ONE transfer, from that wallet, to the treasury, of exactly the agreed lamports, with a
 * valid signature. Anything else is refused, so a browser can neither change the amount nor the destination.
 */

export function buildFeeTransaction(p: { wallet: string; treasury: string; lamports: number; blockhash: string; lastValidBlockHeight?: number }): Transaction {
  const tx = new Transaction({ feePayer: new PublicKey(p.wallet), blockhash: p.blockhash, lastValidBlockHeight: p.lastValidBlockHeight ?? 0 });
  tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(p.wallet), toPubkey: new PublicKey(p.treasury), lamports: p.lamports }));
  return tx;
}

export type FeeCheck = { ok: true } | { ok: false; reason: string };

export function checkSignedFeeTx(signedBase64: unknown, expected: { wallet: string; treasury: string; lamports: number }): FeeCheck {
  if (typeof signedBase64 !== "string" || signedBase64.length < 100 || signedBase64.length > 4000) return { ok: false, reason: "missing" };
  try {
    const tx = Transaction.from(Buffer.from(signedBase64, "base64"));
    if (!tx.feePayer || tx.feePayer.toBase58() !== expected.wallet) return { ok: false, reason: "payer" };
    if (tx.instructions.length !== 1) return { ok: false, reason: "instructions" };
    const ix = tx.instructions[0];
    if (!ix.programId.equals(SystemProgram.programId) || SystemInstruction.decodeInstructionType(ix) !== "Transfer") return { ok: false, reason: "not a transfer" };
    const t = SystemInstruction.decodeTransfer(ix);
    if (t.fromPubkey.toBase58() !== expected.wallet) return { ok: false, reason: "from" };
    if (t.toPubkey.toBase58() !== expected.treasury) return { ok: false, reason: "to" };
    if (BigInt(t.lamports) !== BigInt(expected.lamports)) return { ok: false, reason: "amount" };
    if (!tx.verifySignatures()) return { ok: false, reason: "signature" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
