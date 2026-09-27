/**
 * vanity-import — reads the keypair JSON files `solana-keygen grind` wrote (one per matching address), encrypts
 * each one's secret key at rest, and stores it in Postgres for /api/pump/create to hand out to real launches
 * (src/lib/vanity/stock.ts). Deletes each source file after it's safely in the database — a plaintext private
 * key has no reason to keep sitting on disk once it's encrypted where it needs to be.
 *
 *   npm run vanity:import [-- --dir ./vanity-keys] [--suffix panda]
 *
 * Needs DATABASE_URL and VANITY_STOCK_KEY in the environment (`vercel env pull .env.local`, or set them
 * directly for a one-off run). See docs/VANITY_STOCK.md for how to generate the files this reads and how big
 * a stock to keep.
 */
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { getDb } from "../src/lib/db/client";
import { pgAddVanityKeys } from "../src/lib/db/vanity";
import { encryptSecretKey, hasVanityStockKey } from "../src/lib/vanity/crypto";

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const dir = argValue("--dir", "./vanity-keys");
  const suffix = argValue("--suffix", "panda");

  if (!hasVanityStockKey()) {
    console.error("VANITY_STOCK_KEY isn't set (or isn't 32 random bytes, base64) — nothing would be readable later. Aborting without touching any file.");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set. Aborting without touching any file.");
    process.exit(2);
  }

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`Can't read ${dir} — pass --dir <folder> if your grind output is somewhere else.`);
    process.exit(2);
  }
  if (files.length === 0) {
    console.log(`No .json files in ${dir}. Nothing to do.`);
    return;
  }

  const db = getDb();
  let skippedWrongSuffix = 0;
  let skippedUnreadable = 0;
  const rows: { pubkey: string; suffix: string; ciphertext: string; nonce: string }[] = [];
  const fileByPubkey = new Map<string, string>();

  for (const file of files) {
    const full = path.join(dir, file);
    let keypair: Keypair;
    try {
      const raw = JSON.parse(readFileSync(full, "utf8"));
      keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    } catch {
      console.warn(`Skipping ${file}: not a readable Solana keypair JSON file.`);
      skippedUnreadable++;
      continue;
    }
    const pubkey = keypair.publicKey.toBase58();
    if (!pubkey.endsWith(suffix)) {
      // Never trust the filename or that the folder only has what you think it has — the address itself decides.
      console.warn(`Skipping ${file}: ${pubkey} doesn't end in "${suffix}".`);
      skippedWrongSuffix++;
      continue;
    }
    const enc = encryptSecretKey(keypair.secretKey);
    if (!enc) {
      console.error("VANITY_STOCK_KEY stopped working mid-run — aborting the rest of this batch (nothing already imported is affected).");
      break;
    }
    rows.push({ pubkey, suffix, ...enc });
    fileByPubkey.set(pubkey, full);
  }

  const insertedPubkeys = rows.length ? await pgAddVanityKeys(db, rows) : [];
  // Only delete the files that actually made it into the database — a duplicate (already in the stock from a
  // previous run) is left on disk untouched rather than silently lost.
  for (const pubkey of insertedPubkeys) unlinkSync(fileByPubkey.get(pubkey)!);

  console.log(`Imported ${insertedPubkeys.length} new key(s) ending in "${suffix}".`);
  if (skippedWrongSuffix) console.log(`${skippedWrongSuffix} file(s) skipped — address didn't end in "${suffix}".`);
  if (skippedUnreadable) console.log(`${skippedUnreadable} file(s) skipped — not a readable keypair.`);
  const alreadyStocked = rows.length - insertedPubkeys.length;
  if (alreadyStocked > 0) console.log(`${alreadyStocked} file(s) already in the stock (left on disk, not deleted).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
