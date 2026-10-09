/**
 * create-orders-lookup-table — ONE-TIME setup, run by the OWNER on their own machine: creates PANDA orders' Address Lookup
 * Table (see src/lib/panda-orders/alt.ts), fills it with the accounts every PANDA order shares, and FREEZES it (no
 * authority: nobody can change or close it afterwards — a pre-signed order relies on it for as long as it waits). Its
 * address then goes in PANDA_ORDERS_LOOKUP_TABLE (a public address, not a secret).
 *
 *   npm run create-orders-lookup-table -- --rpc <url> --curve <mint>,<mint> --amm <mint>,<mint>
 *       DRY RUN: prints what would go in it, and the size of a PumpSwap order with and without it; sends nothing
 *   ... add --keypair <file> --yes   really creates it (two transactions signed with that keypair)
 *
 * --curve: two coins still on their Pump.fun bonding curve (SOL-quoted); --amm: two graduated coins with a PumpSwap
 * token/SOL pool. They are only samples to tell shared accounts from coin-specific ones. The keypair file is a Solana
 * CLI JSON keypair of a wallet with ~0.02 SOL; it pays the rent and fees and is the authority only until the freeze.
 */
import { readFileSync } from "node:fs";
import { AddressLookupTableAccount, AddressLookupTableProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { ordersStaticAddresses } from "../src/lib/panda-orders/alt";
import { loadVenue, saleInstructions } from "../src/lib/panda-orders/market";
import { orderTransaction } from "../src/lib/panda-orders/tx";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const mints = (v: string | undefined) => (v ? v.split(",").map((s) => new PublicKey(s.trim())) : []);

async function main() {
  const rpc = arg("rpc") || process.env.SOLANA_RPC_URL;
  const curve = mints(arg("curve"));
  const amm = mints(arg("amm"));
  if (!rpc || curve.length < 2 || amm.length < 2) {
    console.error("Usage: --rpc <url> --curve <mint>,<mint> --amm <mint>,<mint> [--keypair <file> --yes]");
    process.exit(2);
  }
  const connection = new Connection(rpc, "confirmed");
  const addresses = await ordersStaticAddresses(connection, { curve, amm });
  console.log(`The table would hold ${addresses.length} accounts:`);
  for (const a of addresses) console.log("  ", a.toBase58());

  // How much it saves on a real PumpSwap order (two fee transfers: the worst case, recruiter + treasury).
  const user = Keypair.generate().publicKey;
  const v = await loadVenue(connection, amm[0], user);
  if (typeof v !== "string") {
    const sale = await saleInstructions(v, user, BigInt(1_000_000), BigInt(1));
    const fee = [SystemProgram.transfer({ fromPubkey: user, toPubkey: Keypair.generate().publicKey, lamports: 1 }), SystemProgram.transfer({ fromPubkey: user, toPubkey: addresses[addresses.length - 1], lamports: 1 })];
    const nonce = { wallet: user, nonceAccount: Keypair.generate().publicKey, nonceValue: Keypair.generate().publicKey.toBase58(), sale, fee };
    const local = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses } });
    console.log(`\nPumpSwap order size: ${orderTransaction(nonce).serialize().length} B without the table, ${orderTransaction({ ...nonce, lookupTable: local }).serialize().length} B with it (limit 1,232).`);
  }
  const size = 56 + 32 * addresses.length;
  const rent = await connection.getMinimumBalanceForRentExemption(size);
  console.log(`Rent for ${size} bytes: ${(rent / 1e9).toFixed(6)} SOL (locked for good once frozen) + a few thousand lamports of fees.`);

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
  console.log("\nCreating", table.toBase58(), "…");
  await sendAndConfirmTransaction(connection, new Transaction().add(createIx), [payer], { commitment: "confirmed" });
  for (let k = 0; k < addresses.length; k += 20) {
    const extendIx = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: payer.publicKey, payer: payer.publicKey, addresses: addresses.slice(k, k + 20) });
    await sendAndConfirmTransaction(connection, new Transaction().add(extendIx), [payer], { commitment: "confirmed" });
  }
  console.log("filled");
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(AddressLookupTableProgram.freezeLookupTable({ lookupTable: table, authority: payer.publicKey })), [payer], { commitment: "confirmed" });
  console.log("frozen:", sig);
  console.log(`\nDone. Set in Vercel:  PANDA_ORDERS_LOOKUP_TABLE=${table.toBase58()}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
