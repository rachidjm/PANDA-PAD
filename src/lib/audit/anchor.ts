import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

/**
 * Anchoring the audit chain: the head hash is published in a Solana memo transaction signed by an admin (cost: one transaction fee).
 * A rewritten or truncated database can then no longer produce the anchored hash. Browser-safe (web3.js only).
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const anchorMemo = (seq: number, hash: string) => `PANDA-AUDIT v1 seq=${seq} head=${hash}`;

export function parseAnchorMemo(text: string): { seq: number; hash: string } | null {
  const m = /^PANDA-AUDIT v1 seq=(\d+) head=([0-9a-f]{64})$/.exec(text.trim());
  return m ? { seq: Number(m[1]), hash: m[2] } : null;
}

export function buildAnchorTx(wallet: PublicKey, seq: number, hash: string): Transaction {
  return new Transaction().add(
    new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: wallet, isSigner: true, isWritable: false }], data: new TextEncoder().encode(anchorMemo(seq, hash)) as unknown as Buffer })
  );
}

type ParsedInstruction = { programId: PublicKey | string; parsed?: unknown; program?: string; data?: string };
type ParsedTx = { meta?: { err: unknown } | null; transaction: { message: { accountKeys: { pubkey: PublicKey | string; signer: boolean }[]; instructions: ParsedInstruction[] } } } | null;

/** True only if the (confirmed, successful) transaction was signed by `wallet` and carries exactly the memo for this head. Pure: the caller fetched the tx. */
export function anchorTxMatches(tx: ParsedTx, wallet: string, seq: number, hash: string): boolean {
  if (!tx || tx.meta?.err) return false;
  const signer = tx.transaction.message.accountKeys.some((k) => k.signer && String(k.pubkey) === wallet);
  if (!signer) return false;
  const want = anchorMemo(seq, hash);
  return tx.transaction.message.instructions.some((ix) => String(ix.programId) === MEMO_PROGRAM_ID.toBase58() && ix.parsed === want);
}
