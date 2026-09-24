import { AddressLookupTableAccount, Keypair } from "@solana/web3.js";
import { buildLaunchTransaction, MAX_TX_BYTES } from "./create";
import { launchStaticAddresses } from "./launch-alt";
import { MAX_SHAREHOLDERS } from "./fee-shares-validation";

/**
 * Read-only verdict on PANDA's launch lookup table: exists, active, FROZEN (no authority), holds every fixed account of a launch, and a
 * whole launch (coin + fee split) built with it fits Solana's limit for 1 and for the maximum number of shareholders. Used by the admin
 * panel and by `npm run check-lookup-table`. Sends and signs nothing.
 */
export type TableCheck = {
  exists: boolean;
  active: boolean;
  frozen: boolean;
  authority: string | null;
  addresses: number;
  missing: string[];
  fits: { shareholders: number; bytes: number | null }[];
  ok: boolean;
};

export async function checkLaunchTable(table: AddressLookupTableAccount | null): Promise<TableCheck> {
  if (!table) return { exists: false, active: false, frozen: false, authority: null, addresses: 0, missing: [], fits: [], ok: false };
  const have = new Set(table.state.addresses.map((a) => a.toBase58()));
  const missing = (await launchStaticAddresses()).map((a) => a.toBase58()).filter((a) => !have.has(a));
  const fits: TableCheck["fits"] = [];
  for (const n of [1, MAX_SHAREHOLDERS]) {
    const user = Keypair.generate().publicKey;
    const shareholders = Array.from({ length: n }, (_, i) => ({ address: (i === 0 ? user : Keypair.generate().publicKey).toBase58(), shareBps: Math.floor(10_000 / n) + (i === 0 ? 10_000 - Math.floor(10_000 / n) * n : 0) }));
    const tx = await buildLaunchTransaction({ mint: Keypair.generate().publicKey, user, name: "T", symbol: "T", uri: "https://example.com/m.json", shareholders, lookupTable: table, blockhash: "11111111111111111111111111111111" });
    fits.push({ shareholders: n, bytes: tx ? tx.serialize().length : null });
  }
  const active = table.isActive();
  const frozen = table.state.authority === undefined;
  return {
    exists: true,
    active,
    frozen,
    authority: table.state.authority?.toBase58() ?? null,
    addresses: table.state.addresses.length,
    missing,
    fits,
    ok: active && frozen && missing.length === 0 && fits.every((f) => f.bytes !== null && f.bytes <= MAX_TX_BYTES),
  };
}
