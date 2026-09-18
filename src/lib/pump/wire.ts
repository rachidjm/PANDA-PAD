import { Transaction } from "@solana/web3.js";

/** Browser-safe base64 → Transaction, no Buffer polyfill required. */
export function base64ToTransaction(base64: string): Transaction {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Transaction.from(bytes);
}
