import { AddressLookupTableAccount, Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getPumpSdk } from "./client";
import { buildFeeSharingInstructions } from "./fee-sharing";

/**
 * PANDA's Address Lookup Table for launches. A coin's creation and its fee split don't fit one legacy transaction (see
 * create.ts), but as a v0 transaction that looks the launch's fixed accounts up in a table they do (measured 846–1,153 bytes
 * for 1–10 shareholders, against the 1,232-byte limit). The table holds only addresses that are identical in EVERY launch;
 * the mint, the creator and everything derived from them can't be in it. It is created once, by the owner, with
 * `scripts/create-launch-lookup-table.ts`, and its address goes in PANDA_LOOKUP_TABLE (public, not a secret).
 *
 * Without the variable — or if the table can't be read — launches use the two-transaction path instead, which is safe but
 * leaves a window in which a coin exists without its split (see fee-lock.ts). Nothing here ever needs a private key at runtime.
 */

export function launchLookupTableAddress(env: Record<string, string | undefined> = process.env): PublicKey | null {
  const raw = env.PANDA_LOOKUP_TABLE?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

/**
 * The accounts that never change from launch to launch, derived — not hard-coded — by building two launches with different
 * random mints and creators and keeping what they share. Program ids are dropped (a program can't be loaded from a table).
 */
export async function launchStaticAddresses(): Promise<PublicKey[]> {
  const sdk = getPumpSdk();
  const one = async () => {
    const mint = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const create = await sdk.createV2Instruction({ mint, name: "T", symbol: "T", uri: "https://example.com/m.json", creator: user, user, mayhemMode: false });
    const fees = await buildFeeSharingInstructions({ mint, creator: user, shareholders: [{ address: user.toBase58(), shareBps: 10_000 }] });
    return [create, ...fees] as TransactionInstruction[];
  };
  const [a, b] = [await one(), await one()];
  const keys = (ixs: TransactionInstruction[]) => new Set(ixs.flatMap((i) => i.keys.map((k) => k.pubkey.toBase58())));
  const programs = new Set([...a, ...b].map((i) => i.programId.toBase58()));
  const inB = keys(b);
  return [...keys(a)].filter((k) => inB.has(k) && !programs.has(k)).sort().map((k) => new PublicKey(k));
}

/** A table object built locally from a list of addresses — for measuring sizes in tests and the scripts, never sent anywhere. */
export function localLookupTable(addresses: PublicKey[], key: PublicKey = Keypair.generate().publicKey): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key,
    state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses },
  });
}

const CACHE_MS = 10 * 60_000;
const FAILURE_CACHE_MS = 60_000;
let cached: { table: AddressLookupTableAccount; at: number } | null = null;
let failedAt: { address: string; at: number } | null = null;

/** The table from PANDA_LOOKUP_TABLE, or null (variable unset, table missing or deactivated, RPC failure): callers fall back. */
export async function getLaunchLookupTable(connection: Connection, env: Record<string, string | undefined> = process.env): Promise<AddressLookupTableAccount | null> {
  const address = launchLookupTableAddress(env);
  if (!address) return null;
  if (cached && cached.table.key.equals(address) && Date.now() - cached.at < CACHE_MS) return cached.table;
  // A table that couldn't be read is not asked for again for a minute (the public status endpoint and every launch call this).
  if (failedAt && failedAt.address === address.toBase58() && Date.now() - failedAt.at < FAILURE_CACHE_MS) return null;
  failedAt = { address: address.toBase58(), at: Date.now() };
  try {
    const { value } = await connection.getAddressLookupTable(address, { commitment: "confirmed" });
    if (!value || !value.isActive() || value.state.addresses.length === 0) {
      console.warn("[PANDA launch] PANDA_LOOKUP_TABLE is set but the table is missing, empty or deactivated: launches use two transactions");
      return null;
    }
    cached = { table: value, at: Date.now() };
    failedAt = null;
    return value;
  } catch (err) {
    console.warn("[PANDA launch] could not read the launch lookup table:", err instanceof Error ? err.message : err);
    return null;
  }
}
