/**
 * simulate-launch — READ-ONLY dry run of a whole launch (create coin + PANDA's fee split) against mainnet's real programs. It BUILDS the
 * one-transaction v0 launch with PANDA's real lookup table and asks the RPC to SIMULATE it; nothing is signed and nothing is sent.
 *
 *   npm run simulate-launch -- [--rpc <url>] [--table <address>] [--payer <funded public address>]
 *
 * Why it exists: measuring bytes says a launch FITS; only a simulation says it WORKS (it caught a real bug: the fee split failed with the
 * fee program's `NotEnough` error until the creator was passed as the current shareholder). The payer is only an address the simulation
 * debits: any funded PUBLIC address will do (default: Pump's fee-recipient account). Its key is never needed.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { buildLaunchTransaction, MAX_TX_BYTES } from "../src/lib/pump/create";
import { launchLookupTableAddress } from "../src/lib/pump/launch-alt";
import { PANDA_TREASURY } from "../src/lib/pump/constants";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const connection = new Connection(arg("rpc") || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const tableAddress = arg("table") ? new PublicKey(arg("table") as string) : launchLookupTableAddress();
  if (!tableAddress) {
    console.error("Pass --table <address> or set PANDA_LOOKUP_TABLE.");
    process.exit(2);
  }
  const { value: table } = await connection.getAddressLookupTable(tableAddress);
  if (!table) {
    console.error("That lookup table doesn't exist on this network.");
    process.exit(1);
  }
  const payer = new PublicKey(arg("payer") || "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  let bad = 0;
  for (const n of [1, 2, 4, 9]) {
    const others = Array.from({ length: n - 1 }, () => Keypair.generate().publicKey.toBase58());
    const each = Math.floor(9_000 / n);
    const shareholders = [
      { address: PANDA_TREASURY.toBase58(), shareBps: 500 },
      ...(n === 1 ? [{ address: payer.toBase58(), shareBps: 9_500 }] : [{ address: payer.toBase58(), shareBps: 9_500 - each * (n - 1) }, ...others.map((a) => ({ address: a, shareBps: each }))]),
    ];
    const tx = await buildLaunchTransaction({ mint: Keypair.generate().publicKey, user: payer, name: "Test", symbol: "TST", uri: "https://abcdef1234567890.public.blob.vercel-storage.com/panda/1750000000000-metadata-Ab3dE6gH.json", shareholders, lookupTable: table, blockhash });
    if (!tx) {
      console.log(`FAIL ${n + 1} shareholders: does not fit ${MAX_TX_BYTES} bytes (the server would fall back to two transactions)`);
      bad++;
      continue;
    }
    const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    const ok = !sim.value.err;
    if (!ok) bad++;
    console.log(`${ok ? "OK  " : "FAIL"} ${shareholders.length} shareholders: ${tx.serialize().length} bytes, ${sim.value.unitsConsumed ?? "?"} compute units${ok ? "" : ` — ${JSON.stringify(sim.value.err)}: ${(sim.value.logs ?? []).slice(-3).join(" | ")}`}`);
  }
  console.log(bad === 0 ? "\nSIMULATION OK — nothing was signed or sent" : `\nSIMULATION FAILED (${bad})`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
