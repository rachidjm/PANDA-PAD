/**
 * check-launch-lookup-table — READ-ONLY check of PANDA's launch lookup table. Uses no key and sends nothing.
 *
 *   npm run check-lookup-table -- [<table address>] [--rpc <url>]        (address defaults to PANDA_LOOKUP_TABLE)
 *
 * Verifies the table is active, FROZEN (no authority: nobody can change or close it), holds every account a launch needs, and that
 * a whole launch (coin + fee split) built with it fits Solana's 1,232-byte limit for 1 and for the maximum 10 shareholders.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { buildLaunchTransaction, MAX_TX_BYTES } from "../src/lib/pump/create";
import { launchLookupTableAddress, launchStaticAddresses } from "../src/lib/pump/launch-alt";
import { MAX_SHAREHOLDERS } from "../src/lib/pump/fee-shares-validation";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const positional = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
  let address: PublicKey | null = null;
  try {
    address = positional ? new PublicKey(positional) : launchLookupTableAddress();
  } catch {
    address = null;
  }
  if (!address) {
    console.error("Usage: npm run check-lookup-table -- [<table address>] [--rpc <url>]   (or set PANDA_LOOKUP_TABLE)");
    process.exit(2);
  }
  const connection = new Connection(arg("rpc") || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const { value: table } = await connection.getAddressLookupTable(address);
  let bad = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    if (!ok) bad++;
    console.log(ok ? "OK  " : "FAIL", label, detail);
  };
  if (!table) {
    console.log("FAIL the table does not exist at", address.toBase58());
    process.exit(1);
  }
  console.log(`Table ${address.toBase58()}: ${table.state.addresses.length} accounts`);
  check(table.isActive(), "active (not deactivated)");
  check(table.state.authority === undefined, "frozen (no authority: it can't be changed or closed)", table.state.authority ? `authority is ${table.state.authority.toBase58()} — it can still deactivate the table and break launches` : "");
  const have = new Set(table.state.addresses.map((a) => a.toBase58()));
  const missing = (await launchStaticAddresses()).filter((a) => !have.has(a.toBase58()));
  check(missing.length === 0, "holds every fixed account of a launch", missing.map((m) => m.toBase58()).join(", "));

  for (const n of [1, MAX_SHAREHOLDERS]) {
    const user = Keypair.generate().publicKey;
    const shareholders = Array.from({ length: n }, (_, i) => ({ address: (i === 0 ? user : Keypair.generate().publicKey).toBase58(), shareBps: Math.floor(10_000 / n) + (i === 0 ? 10_000 - Math.floor(10_000 / n) * n : 0) }));
    const tx = await buildLaunchTransaction({ mint: Keypair.generate().publicKey, user, name: "T", symbol: "T", uri: "https://example.com/m.json", shareholders, lookupTable: table, blockhash: "11111111111111111111111111111111" });
    check(tx !== null, `a launch with ${n} shareholder(s) fits ${MAX_TX_BYTES} bytes`, tx ? `${tx.serialize().length} bytes` : "does not fit");
  }
  console.log(bad === 0 ? "\nCHECK OK" : `\nCHECK FAILED (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
