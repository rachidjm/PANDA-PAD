import { AddressLookupTableAccount, Connection, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getOnlinePumpAmmSdk } from "@/lib/pump/amm-client";
import { getOnlinePumpSdk } from "@/lib/pump/client";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { loadVenue, saleInstructions } from "./market";

/**
 * PANDA orders' own Address Lookup Table (PANDA_ORDERS_LOOKUP_TABLE — a public address, not a secret). A PumpSwap sale
 * plus the nonce, the compute budget and PANDA's fee transfers comes within a few bytes of Solana's 1,232-byte limit
 * (measured 1,228 B); with the fixed accounts looked up in a table it fits comfortably.
 *
 * A pre-signed order depends on its table for as long as it waits, so ONLY a FROZEN table is used (no authority: nobody,
 * PANDA included, can change, deactivate or close it — and a table can never redirect anything: its entries are fixed).
 * Created once by the owner with scripts/create-orders-lookup-table.ts. Unset or not frozen: orders are built without it,
 * and the few that don't fit are refused with a clear message instead.
 */

export function ordersLookupTableAddress(env: Record<string, string | undefined> = process.env): PublicKey | null {
  const raw = env.PANDA_ORDERS_LOOKUP_TABLE?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

let cached: { key: string; table: AddressLookupTableAccount | null; at: number } | null = null;
const CACHE_MS = 10 * 60_000;

/** The configured table — only if it exists, is FROZEN and still active. Otherwise null (orders are built without it). */
export async function getOrdersLookupTable(connection: Connection, env: Record<string, string | undefined> = process.env): Promise<AddressLookupTableAccount | null> {
  const address = ordersLookupTableAddress(env);
  if (!address) return null;
  if (cached && cached.key === address.toBase58() && Date.now() - cached.at < CACHE_MS) return cached.table;
  let table: AddressLookupTableAccount | null = null;
  try {
    const res = await connection.getAddressLookupTable(address);
    const t = res.value;
    if (t && t.isActive() && t.state.authority === undefined) table = t;
  } catch {
    table = null;
  }
  cached = { key: address.toBase58(), table, at: Date.now() };
  return table;
}

/**
 * The accounts every PANDA order shares whatever the coin and the wallet: measured, not hard-coded — sales are built on
 * two real coins per venue for random wallets and only what appears for BOTH coins is kept (so nothing coin- or
 * wallet-specific can end up in it); plus Pump's fee-recipient lists (one is picked at random per transaction) and
 * PANDA's treasury. Program ids are left out (a program can't be loaded from a table).
 */
export async function ordersStaticAddresses(connection: Connection, samples: { curve: PublicKey[]; amm: PublicKey[] }): Promise<PublicKey[]> {
  const builds = async (mint: PublicKey): Promise<TransactionInstruction[]> => {
    const out: TransactionInstruction[] = [];
    for (let k = 0; k < 6; k++) {
      const user = Keypair.generate().publicKey;
      const v = await loadVenue(connection, mint, user);
      if (typeof v === "string") throw new Error(`sample coin ${mint.toBase58()} is ${v}`);
      out.push(...(await saleInstructions(v, user, BigInt(1_000_000), BigInt(1))));
    }
    return out;
  };
  const keysOf = (ixs: TransactionInstruction[]) => new Set(ixs.flatMap((i) => i.keys.map((k) => k.pubkey.toBase58())));
  const programs = new Set<string>();
  const shared = new Set<string>();
  for (const pair of [samples.curve, samples.amm]) {
    if (pair.length < 2) continue;
    const [a, b] = [await builds(pair[0]), await builds(pair[1])];
    [...a, ...b].forEach((i) => programs.add(i.programId.toBase58()));
    const inB = keysOf(b);
    for (const k of keysOf(a)) if (inB.has(k)) shared.add(k);
  }
  // Fee recipients are picked at random per sale: every candidate goes in, with its WSOL account for the AMM.
  const global = await getOnlinePumpSdk(connection).fetchGlobal();
  for (const r of [global.feeRecipient, ...global.feeRecipients]) shared.add(r.toBase58());
  const ammGlobal = await getOnlinePumpAmmSdk(connection).fetchGlobalConfigAccount();
  for (const r of ammGlobal.protocolFeeRecipients) {
    shared.add(r.toBase58());
    shared.add(getAssociatedTokenAddressSync(NATIVE_MINT, r, true, TOKEN_PROGRAM_ID).toBase58());
  }
  shared.add(PANDA_TREASURY.toBase58());
  shared.add(NATIVE_MINT.toBase58());
  return [...shared].filter((k) => !programs.has(k) && k !== PublicKey.default.toBase58()).sort().map((k) => new PublicKey(k)).slice(0, 255);
}

