import { AddressLookupTableProgram, PublicKey, Transaction } from "@solana/web3.js";

/**
 * Browser-safe builders for creating PANDA's launch Address Lookup Table with the admin's wallet (Phantom signs; no key file, no
 * server-side signing). Two transactions: (1) create the table and fill it, (2) FREEZE it — a frozen table has no authority, so
 * nobody can change or close it afterwards. Only web3.js here (no Pump SDK), so /admin can import it.
 */

/** Create + extend in one transaction. The table's address is derived from the authority and the slot. */
export function buildCreateTableTx({ authority, recentSlot, addresses }: { authority: PublicKey; recentSlot: number; addresses: PublicKey[] }): { tx: Transaction; table: PublicKey } {
  const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority, payer: authority, recentSlot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority, payer: authority, addresses });
  return { tx: new Transaction().add(createIx, extendIx), table };
}

export function buildFreezeTx({ authority, table }: { authority: PublicKey; table: PublicKey }): Transaction {
  return new Transaction().add(AddressLookupTableProgram.freezeLookupTable({ lookupTable: table, authority }));
}
