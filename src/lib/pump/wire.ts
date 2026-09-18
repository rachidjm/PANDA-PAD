import { Transaction, VersionedTransaction } from "@solana/web3.js";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Browser-safe base64 → Transaction, no Buffer polyfill required. */
export function base64ToTransaction(base64: string): Transaction {
  return Transaction.from(base64ToBytes(base64));
}

/** Browser-safe base64 → VersionedTransaction, for Jupiter-routed swaps. */
export function base64ToVersionedTransaction(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(base64));
}
