/**
 * check-launch-lookup-table — READ-ONLY check of PANDA's launch lookup table. Uses no key and sends nothing.
 *
 *   npm run check-lookup-table -- [<table address>] [--rpc <url>]        (address defaults to PANDA_LOOKUP_TABLE)
 *
 * Verifies the table is active, FROZEN (no authority: nobody can change or close it), holds every account a launch needs, and that
 * a whole launch (coin + fee split) built with it fits Solana's 1,232-byte limit for 1 and for the maximum 10 shareholders.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { MAX_TX_BYTES } from "../src/lib/pump/create";
import { launchLookupTableAddress } from "../src/lib/pump/launch-alt";
import { checkLaunchTable } from "../src/lib/pump/launch-alt-check";

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
  const r = await checkLaunchTable(table);
  let bad = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    if (!ok) bad++;
    console.log(ok ? "OK  " : "FAIL", label, detail);
  };
  check(r.exists, `table exists at ${address.toBase58()}`, r.exists ? `${r.addresses} accounts` : "");
  if (r.exists) {
    check(r.active, "active (not deactivated)");
    check(r.frozen, "frozen (no authority: it can't be changed or closed)", r.authority ? `authority is ${r.authority} — it can still deactivate the table and break launches` : "");
    check(r.missing.length === 0, "holds every fixed account of a launch", r.missing.join(", "));
    for (const f of r.fits) check(f.bytes !== null && f.bytes <= MAX_TX_BYTES, `a launch with ${f.shareholders} shareholder(s) fits ${MAX_TX_BYTES} bytes`, f.bytes ? `${f.bytes} bytes` : "does not fit");
  }
  console.log(bad === 0 ? "\nCHECK OK" : `\nCHECK FAILED (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
