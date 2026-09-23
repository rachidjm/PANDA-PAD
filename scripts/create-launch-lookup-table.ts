/**
 * create-launch-lookup-table — ONE-TIME setup, run by the OWNER on their own machine: creates PANDA's Address Lookup Table
 * for launches (see src/lib/pump/launch-alt.ts), fills it with the launch's fixed accounts, and FREEZES it (no authority: nobody
 * can change or close it afterwards). Its address then goes in PANDA_LOOKUP_TABLE (a public address, not a secret).
 *
 *   npm run create-lookup-table -- --rpc <url>                         DRY RUN: prints what would go in it and the cost; sends nothing
 *   npm run create-lookup-table -- --rpc <url> --keypair <file> --yes  really creates it (two transactions signed with that keypair)
 *
 * The keypair file is a Solana CLI JSON keypair of a wallet with ~0.01 SOL; it pays the rent and the fees and is the
 * table's authority only until the freeze. PANDA's code never sees it and this repository never stores it. Without --yes
 * nothing is signed or sent, and the keypair is not even read.
 */
import { readFileSync } from "node:fs";
import { AddressLookupTableProgram, Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { launchStaticAddresses } from "../src/lib/pump/launch-alt";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rpc = arg("rpc") || process.env.SOLANA_RPC_URL;
  if (!rpc) {
    console.error("Pass --rpc <url> (or set SOLANA_RPC_URL).");
    process.exit(2);
  }
  const connection = new Connection(rpc, "confirmed");
  const addresses = await launchStaticAddresses();
  console.log(`The table would hold ${addresses.length} accounts (identical in every launch; program ids can't be loaded from a table):`);
  for (const a of addresses) console.log("  ", a.toBase58());

  const size = 56 + 32 * addresses.length;
  const rent = await connection.getMinimumBalanceForRentExemption(size);
  console.log(`\nRent for ${size} bytes: ${(rent / 1e9).toFixed(6)} SOL (locked in the table; it can't be reclaimed once frozen) + a few thousand lamports of fees.`);

  if (!process.argv.includes("--yes")) {
    console.log("\nDRY RUN — nothing signed or sent. Add --keypair <file> --yes to create it.");
    return;
  }
  const keypairPath = arg("keypair");
  if (!keypairPath) {
    console.error("--yes needs --keypair <file>.");
    process.exit(2);
  }
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8"))));
  const slot = await connection.getSlot("finalized");
  const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses });
  console.log("\nCreating", table.toBase58(), "…");
  const sig1 = await sendAndConfirmTransaction(connection, new Transaction().add(createIx, extendIx), [payer], { commitment: "confirmed" });
  console.log("created + filled:", sig1);
  const sig2 = await sendAndConfirmTransaction(connection, new Transaction().add(AddressLookupTableProgram.freezeLookupTable({ lookupTable: table, authority: payer.publicKey })), [payer], { commitment: "confirmed" });
  console.log("frozen:", sig2);
  console.log(`\nDone. Set in Vercel:  PANDA_LOOKUP_TABLE=${table.toBase58()}\nThen verify with:  npm run check-lookup-table -- --rpc <url>`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
