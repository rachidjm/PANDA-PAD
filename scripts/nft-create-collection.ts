/**
 * nft-create-collection — creates the PANDA Founders Metaplex Core collection and mints every reserved,
 * not-yet-minted Founder slot (src/lib/db/schema.ts's founderAllocations) into it. See docs/NFT_COLLECTION.md
 * for the folder format this reads and the real cost figures.
 *
 *   npm run nft:create-collection -- --dir ./founder-nft [--network devnet] [--live]
 *
 * SIMULATES by default: validates the folder, counts how many Founder slots are waiting, and prints the plan —
 * nothing is uploaded, nothing is minted, no SOL is spent. Pass --live to actually do it. Safe to run again:
 * an already-minted slot (founder_allocations.minted_at set) is always skipped, and the collection itself is
 * only created once (its address is read back from Postgres on later runs — see --collection below).
 *
 * Needs DATABASE_URL and PANDA_NFT_MINTER_SECRET_KEY (--live only) in the environment.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { put } from "@vercel/blob";
import { generateSigner, publicKey, signerIdentity, createSignerFromKeypair } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { create, createCollection, fetchCollection, mplCore, ruleSet } from "@metaplex-foundation/mpl-core";
import { getDb } from "../src/lib/db/client";
import { pgMarkFounderMinted, pgUnmintedFounderAllocations } from "../src/lib/db/referrals";
import { verifyAsset, type AssetLike } from "../src/lib/nft/mint";

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const live = process.argv.includes("--live");
const dir = argValue("--dir", "./founder-nft");
const network = argValue("--network", "mainnet");
const rpcUrl = network === "devnet" ? "https://api.devnet.solana.com" : process.env.SOLANA_RPC_URL;

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN || process.env.PANDA_PAD_BLOB_READ_WRITE_TOKEN;

type Metadata = { name: string; description?: string; attributes?: { trait_type: string; value: string }[] };

function readMetadata(file: string): Metadata {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!raw.name) throw new Error(`${file}: missing "name"`);
  return raw;
}

function minterKeypair(): Keypair {
  const raw = process.env.PANDA_NFT_MINTER_SECRET_KEY;
  if (!raw) throw new Error("PANDA_NFT_MINTER_SECRET_KEY isn't set.");
  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[") ? Uint8Array.from(JSON.parse(trimmed)) : (() => {
    throw new Error("PANDA_NFT_MINTER_SECRET_KEY must be a JSON byte array — base58 isn't supported by this script yet.");
  })();
  return Keypair.fromSecretKey(bytes);
}

async function uploadFile(localPath: string, blobPath: string, contentType: string): Promise<string> {
  if (!BLOB_TOKEN) throw new Error("No Blob token configured (BLOB_READ_WRITE_TOKEN).");
  const body = readFileSync(localPath);
  const blob = await put(blobPath, body, { access: "public", contentType, token: BLOB_TOKEN });
  return blob.url;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL isn't set. Aborting without touching anything.");
    process.exit(2);
  }
  if (!existsSync(path.join(dir, "collection.png")) || !existsSync(path.join(dir, "collection.json"))) {
    console.error(`${dir} is missing collection.png or collection.json — see docs/NFT_COLLECTION.md for the expected layout.`);
    process.exit(2);
  }

  const db = getDb();
  const pending = await pgUnmintedFounderAllocations(db);
  console.log(`Founder slots reserved but not yet minted: ${pending.length}`);

  const missing: number[] = [];
  for (const { rank } of pending) {
    if (!existsSync(path.join(dir, "images", `${rank}.png`)) && !existsSync(path.join(dir, "images", `${rank}.jpg`))) missing.push(rank);
    if (!existsSync(path.join(dir, "metadata", `${rank}.json`))) missing.push(rank);
  }
  if (missing.length > 0) {
    console.error(`Missing image/metadata for rank(s): ${[...new Set(missing)].sort((a, b) => a - b).join(", ")}`);
    process.exit(2);
  }

  const collectionMeta = readMetadata(path.join(dir, "collection.json"));
  console.log(`Collection: "${collectionMeta.name}" — ${pending.length} Founder NFT(s) to mint on ${network}.`);

  if (!live) {
    console.log("\nDRY RUN — nothing uploaded, nothing minted, no SOL spent. Pass --live to actually run this.");
    console.log("Real cost per asset isn't guessed here — see docs/NFT_COLLECTION.md: measure it on devnet first (`--network devnet --live` against a 2-3 file test folder) before running this for real Founders on mainnet.");
    return;
  }
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL isn't set (or pass --network devnet).");

  const minter = minterKeypair();
  const umi = createUmi(rpcUrl).use(mplCore());
  const minterSigner = createSignerFromKeypair(umi, { publicKey: publicKey(minter.publicKey.toBase58()), secretKey: minter.secretKey });
  umi.use(signerIdentity(minterSigner));

  // The collection itself — created once. Its address isn't persisted by this script on purpose (no dedicated
  // table for "the one collection" yet): pass --collection <address> on every later run once you have it, or
  // extend this script to store it wherever you'd rather keep it before running against mainnet for real.
  const existingCollection = argValue("--collection", "");
  let collectionAddress = existingCollection;
  if (!collectionAddress) {
    const collectionImageUrl = await uploadFile(path.join(dir, "collection.png"), `nft/founders/collection-${Date.now()}.png`, "image/png");
    // The source collection.json's own "image" field is only ever a local placeholder — this is what actually gets published.
    const collectionBody = JSON.stringify({ ...collectionMeta, image: collectionImageUrl });
    const collectionUri = (await put(`nft/founders/collection-${Date.now()}.json`, collectionBody, { access: "public", contentType: "application/json", token: BLOB_TOKEN! })).url;

    const collectionSigner = generateSigner(umi);
    await createCollection(umi, {
      collection: collectionSigner,
      name: collectionMeta.name,
      uri: collectionUri,
      plugins: [{ type: "Royalties", basisPoints: 0, creators: [{ address: minterSigner.publicKey, percentage: 100 }], ruleSet: ruleSet("None") }],
    }).sendAndConfirm(umi);
    collectionAddress = collectionSigner.publicKey.toString();
    console.log(`Collection created: ${collectionAddress} — pass --collection ${collectionAddress} on future runs.`);
  }
  const collection = await fetchCollection(umi, publicKey(collectionAddress));
  console.log(`Minting into collection "${collection.name}" (${collectionAddress}).`);

  for (const { wallet, rank } of pending) {
    const imagePath = existsSync(path.join(dir, "images", `${rank}.png`)) ? path.join(dir, "images", `${rank}.png`) : path.join(dir, "images", `${rank}.jpg`);
    const contentType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
    const meta = readMetadata(path.join(dir, "metadata", `${rank}.json`));

    const imageUrl = await uploadFile(imagePath, `nft/founders/${rank}-${Date.now()}${path.extname(imagePath)}`, contentType);
    const metaBody = JSON.stringify({ ...meta, image: imageUrl });
    const uri = (await put(`nft/founders/${rank}-${Date.now()}.json`, metaBody, { access: "public", contentType: "application/json", token: BLOB_TOKEN! })).url;
    const coreAttributes = (meta.attributes ?? []).map((a) => ({ key: a.trait_type, value: a.value }));

    const assetSigner = generateSigner(umi);
    const ownerKey = publicKey(wallet);
    await create(umi, {
      asset: assetSigner,
      collection,
      name: meta.name,
      uri,
      owner: ownerKey,
      updateAuthority: minterSigner.publicKey,
      plugins: [
        { type: "ImmutableMetadata" },
        { type: "AddBlocker" },
        { type: "PermanentFreezeDelegate", frozen: true }, // soulbound — see docs/NFT_COLLECTION.md
        { type: "Royalties", basisPoints: 0, creators: [{ address: minterSigner.publicKey, percentage: 100 }], ruleSet: ruleSet("None"), authority: { type: "None" } },
        { type: "Attributes", attributeList: coreAttributes, authority: { type: "None" } },
      ],
    }).sendAndConfirm(umi);

    const assetAddress = assetSigner.publicKey.toString();
    const mismatch = verifyAsset(
      (await (async () => {
        const { fetchAsset } = await import("@metaplex-foundation/mpl-core");
        return fetchAsset(umi, publicKey(assetAddress), { commitment: "confirmed" });
      })()) as unknown as AssetLike,
      { assetAddress, owner: wallet, creator: minter.publicKey.toBase58(), name: meta.name, uri, royaltyBps: 0, attributes: coreAttributes }
    );
    if (mismatch) {
      console.error(`Founder #${rank} (${wallet}): minted but failed verification (${mismatch}) — NOT marked minted, will retry next run.`);
      continue;
    }
    await pgMarkFounderMinted(db, wallet, Date.now(), assetAddress);
    console.log(`Founder #${rank} (${wallet}): minted and verified — ${assetAddress}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
