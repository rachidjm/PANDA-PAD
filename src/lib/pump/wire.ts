import { Transaction, VersionedTransaction } from "@solana/web3.js";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Browser-safe signed VersionedTransaction → base64, for handing a signed deposit/withdrawal back to a server route. */
export function versionedTransactionToBase64(tx: VersionedTransaction): string {
  return bytesToBase64(tx.serialize());
}

/** Browser-safe base64 → Transaction, no Buffer polyfill required. */
export function base64ToTransaction(base64: string): Transaction {
  return Transaction.from(base64ToBytes(base64));
}

/** Browser-safe base64 → VersionedTransaction, for Jupiter-routed swaps. */
export function base64ToVersionedTransaction(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(base64));
}
