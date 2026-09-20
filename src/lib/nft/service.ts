import { PublicKey } from "@solana/web3.js";
import { mintDecision, Theme } from "@/lib/themes/theme";
import { PENDING_TTL_MS } from "./dedupe";
import { ImageRejected, processImage } from "./image";
import { buildMetadata, validateTexts } from "./metadata";
import { BuiltMint, expectedAttributes, ExpectedAsset } from "./mint";
import {
  appendPublished,
  extendSlot,
  getRecord,
  NftRecord,
  publishImage,
  publishSlot,
  releaseImage,
  releaseSlot,
  reserveImage,
  reserveSlot,
  saveRecord,
  updateRecord,
} from "./store";

/**
 * The NFT creation flow: upload -> prepare -> confirm. All I/O is injected so
 * every rule is tested without a chain or a network. The rules that matter:
 *
 *  - a NEW NFT can only start in a theme that passes `mintDecision` right now,
 *    and is re-checked at prepare — a theme that closed in between refuses;
 *  - at most `creationLimit` NFTs per wallet per theme (atomic slot);
 *  - exact duplicates are refused; near duplicates need an admin's approval
 *    before they can be minted;
 *  - "published" is only ever set after the asset is read back from the chain
 *    and matches exactly what PANDA specified;
 *  - a mint whose transaction was prepared before the theme closed may still
 *    finish (it was accepted in time); nothing new may start.
 */

export type Failure = { ok: false; code: string; error: string; status: number };
const fail = (code: string, error: string, status: number): Failure => ({ ok: false, code, error, status });

export type NftDeps = {
  now: () => number;
  newId: () => string;
  getTheme: (slug: string) => Promise<Theme | null>;
  putFile: (path: string, bytes: Buffer, contentType: string) => Promise<string>;
  buildTx: (args: { wallet: string; expected: ExpectedAsset }) => Promise<BuiltMint>;
  signatureStatus: (signature: string) => Promise<"confirmed" | "failed" | "pending">;
  /** null when the on-chain asset matches `expected`; otherwise the reason ("asset not found on-chain" = not visible yet). */
  verifyOnChain: (expected: ExpectedAsset) => Promise<string | null>;
  siteUrl: string;
  alert: (event: string, details: Record<string, unknown>) => Promise<void>;
};

/** How long a prepared mint must wait before the wallet may ask for a DIFFERENT asset address (the old blockhash has expired by then). */
export const REPREPARE_AFTER_MS = 3 * 60_000;

const expectedFor = (rec: NftRecord, assetAddress: string): ExpectedAsset => ({
  assetAddress,
  owner: rec.wallet,
  name: rec.name,
  uri: rec.metadataUri,
  royaltyBps: rec.royaltyBps,
  attributes: expectedAttributes({ title: rec.themeTitle, themeId: rec.themeId }, rec.sha256),
});

// ---- 1. upload -------------------------------------------------------------

export async function uploadNft(
  deps: NftDeps,
  args: { wallet: string; themeSlug: string; name: unknown; description: unknown; file: Uint8Array }
): Promise<{ ok: true; record: NftRecord; resumed: boolean } | Failure> {
  const now = deps.now();
  const theme = await deps.getTheme(args.themeSlug);
  const decision = mintDecision(theme, now);
  if (!decision.ok || !theme) return fail("THEME_CLOSED", decision.ok ? "Unknown theme." : decision.reason, 409);

  const texts = validateTexts({ name: args.name, description: args.description });
  if (!texts.ok) return fail("BAD_TEXT", texts.error, 400);

  let image;
  try {
    image = await processImage(args.file);
  } catch (err) {
    if (err instanceof ImageRejected) return fail("BAD_IMAGE", err.message, 400);
    throw err;
  }

  const contentId = deps.newId();
  if ((await reserveSlot(theme.themeId, args.wallet, contentId, theme.creationLimit, now)) === "limit") {
    return fail("LIMIT_REACHED", `You've reached the limit of ${theme.creationLimit} NFT(s) for this theme.`, 409);
  }

  const verdict = await reserveImage(
    { pixelHash: image.pixelHash, dhash: image.dhash },
    { contentId, pixelHash: image.pixelHash, dhash: image.dhash, wallet: args.wallet, themeId: theme.themeId, status: "pending", expiresAt: now + PENDING_TTL_MS, createdAt: now },
    now
  );

  if (verdict.kind === "exact") {
    await releaseSlot(theme.themeId, args.wallet, contentId);
    return fail("DUPLICATE", "This image has already been submitted. Only original artwork can be minted.", 409);
  }
  if (verdict.kind === "own_pending") {
    await releaseSlot(theme.themeId, args.wallet, contentId);
    const existing = await getRecord(verdict.of.contentId);
    if (existing && existing.wallet === args.wallet) return { ok: true, record: existing, resumed: true };
    return fail("DUPLICATE", "This image has already been submitted.", 409);
  }

  try {
    const imageUrl = await deps.putFile(`nft/images/${image.pixelHash}.${image.ext}`, image.bytes, image.mime);
    const metadata = buildMetadata({
      name: texts.name,
      description: texts.description,
      imageUrl,
      imageMime: image.mime,
      siteUrl: deps.siteUrl,
      creator: args.wallet,
      theme: { slug: theme.slug, title: theme.title, themeId: theme.themeId },
      contentHash: image.sha256,
    });
    const metadataUri = await deps.putFile(`nft/metadata/${contentId}.json`, Buffer.from(JSON.stringify(metadata)), "application/json");

    const record: NftRecord = {
      contentId,
      wallet: args.wallet,
      themeId: theme.themeId,
      themeSlug: theme.slug,
      themeTitle: theme.title,
      royaltyBps: theme.royaltyBps,
      name: texts.name,
      description: texts.description,
      imageUrl,
      imageMime: image.mime,
      metadataUri,
      width: image.width,
      height: image.height,
      pixelHash: image.pixelHash,
      dhash: image.dhash,
      sha256: image.sha256,
      originalSha256: image.originalSha256,
      review: verdict.kind === "near" ? "REVIEW_REQUIRED" : "ORIGINAL",
      ...(verdict.kind === "near" ? { nearOf: { contentId: verdict.of.contentId, distance: verdict.distance } } : {}),
      status: "UPLOADED",
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
    };
    await saveRecord(record);
    return { ok: true, record, resumed: false };
  } catch (err) {
    await releaseImage(contentId).catch(() => {});
    await releaseSlot(theme.themeId, args.wallet, contentId).catch(() => {});
    await deps.alert("NFT upload storage failed", { contentId, error: String(err).slice(0, 200) });
    return fail("STORAGE", "Couldn't store your image — please try again.", 503);
  }
}

// ---- 2. prepare ------------------------------------------------------------

export async function prepareMint(
  deps: NftDeps,
  args: { wallet: string; contentId: string; assetAddress: unknown }
): Promise<{ ok: true; transactionBase64: string; lastValidBlockHeight: number; expected: ExpectedAsset } | Failure> {
  const now = deps.now();
  const rec = await getRecord(args.contentId);
  if (!rec || rec.wallet !== args.wallet) return fail("NOT_FOUND", "No such upload.", 404);
  if (rec.status !== "UPLOADED" && rec.status !== "PREPARED") return fail("BAD_STATE", `This NFT is already ${rec.status.toLowerCase()}.`, 409);
  if (rec.review === "REVIEW_REQUIRED") return fail("REVIEW_PENDING", "This image looks similar to an existing one and is waiting for review.", 409);
  if (rec.review === "REJECTED") return fail("REJECTED", "This image was rejected in review.", 409);

  const theme = await deps.getTheme(rec.themeSlug);
  const decision = mintDecision(theme, now);
  if (!decision.ok) return fail("THEME_CLOSED", decision.reason, 409);

  let asset: PublicKey;
  try {
    // PublicKey happily accepts numbers and byte arrays as "keys", so demand a base58 string first.
    if (typeof args.assetAddress !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.assetAddress)) throw new Error("not a base58 address");
    asset = new PublicKey(args.assetAddress);
  } catch {
    return fail("BAD_ASSET", "Invalid asset address.", 400);
  }
  if (asset.toBase58() === args.wallet) return fail("BAD_ASSET", "The asset address must be a fresh key.", 400);
  const assetAddress = asset.toBase58();

  const outcome = await updateRecord<"ok" | "elsewhere" | "gone">(rec.contentId, (cur) => {
    if (!cur || cur.wallet !== args.wallet) return { next: cur, result: "gone" };
    if (cur.status === "PREPARED" && cur.assetAddress !== assetAddress && cur.preparedAt !== undefined && now - cur.preparedAt < REPREPARE_AFTER_MS) {
      return { next: cur, result: "elsewhere" }; // the earlier transaction could still land
    }
    if (cur.status !== "UPLOADED" && cur.status !== "PREPARED") return { next: cur, result: "gone" };
    const sameAsset = cur.status === "PREPARED" && cur.assetAddress === assetAddress;
    return { next: { ...cur, status: "PREPARED", assetAddress, preparedAt: sameAsset ? cur.preparedAt : now }, result: "ok" };
  });
  if (outcome === "elsewhere") {
    return fail("PREPARED_ELSEWHERE", "A mint for this NFT was just started with another key — use the same key, or wait a few minutes.", 409);
  }
  if (outcome === "gone") return fail("BAD_STATE", "This NFT can't be prepared right now.", 409);

  await extendSlot(rec.themeId, rec.wallet, rec.contentId, now + PENDING_TTL_MS);

  const expected = expectedFor({ ...rec, assetAddress }, assetAddress);
  const built = await deps.buildTx({ wallet: args.wallet, expected });
  return { ok: true, transactionBase64: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight, expected };
}

// ---- 3. confirm ------------------------------------------------------------

export async function confirmMint(
  deps: NftDeps,
  args: { wallet: string; contentId: string; signature?: unknown }
): Promise<{ ok: true; record: NftRecord; alreadyPublished: boolean } | Failure> {
  const now = deps.now();
  const rec = await getRecord(args.contentId);
  if (!rec || rec.wallet !== args.wallet) return fail("NOT_FOUND", "No such upload.", 404);
  if (rec.status === "PUBLISHED") return { ok: true, record: rec, alreadyPublished: true };
  if (rec.status !== "PREPARED" || !rec.assetAddress) return fail("BAD_STATE", "This NFT hasn't been prepared for minting.", 409);
  // A signature is optional: someone who closed the tab after signing has no signature to give. Without one
  // nothing is taken on trust — the asset itself is read from the chain and must match exactly, which is
  // proof enough that the mint happened (and by whom: the owner must be this wallet).
  let signature = "";
  if (args.signature !== undefined && args.signature !== null) {
    if (typeof args.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(args.signature)) return fail("BAD_SIGNATURE", "Invalid transaction signature.", 400);
    signature = args.signature;
    const status = await deps.signatureStatus(signature);
    if (status === "failed") return fail("TX_FAILED", "The transaction failed on-chain — nothing was minted. You can try again.", 409);
    if (status === "pending") return fail("PENDING", "The transaction isn't confirmed yet — check again shortly.", 202);
  }

  const expected = expectedFor(rec, rec.assetAddress);
  const problem = await deps.verifyOnChain(expected);
  if (problem === "asset not found on-chain") return fail("PENDING", "The transaction is confirmed but the asset isn't visible yet — check again shortly.", 202);
  if (problem) {
    await updateRecord(rec.contentId, (cur) => ({ next: cur && cur.status === "PREPARED" ? { ...cur, status: "REJECTED_ONCHAIN" as const, failReason: problem, ...(signature ? { signature } : {}) } : cur, result: null }));
    await deps.alert("Minted asset doesn't match what PANDA specified — NOT published", { contentId: rec.contentId, asset: rec.assetAddress, problem });
    return fail("MISMATCH", "The minted asset doesn't match the expected NFT, so it wasn't published.", 409);
  }

  const published = await updateRecord<NftRecord | null>(rec.contentId, (cur) => {
    if (!cur || (cur.status !== "PREPARED" && cur.status !== "PUBLISHED")) return { next: cur, result: null };
    if (cur.status === "PUBLISHED") return { next: cur, result: cur };
    const next: NftRecord = { ...cur, status: "PUBLISHED", ...(signature ? { signature } : {}), publishedAt: now };
    return { next, result: next };
  });
  if (!published) return fail("BAD_STATE", "This NFT can't be published.", 409);

  await publishImage(rec.contentId);
  await publishSlot(rec.themeId, rec.wallet, rec.contentId);
  await appendPublished(rec.themeId, {
    contentId: rec.contentId,
    assetAddress: rec.assetAddress,
    wallet: rec.wallet,
    name: rec.name,
    imageUrl: rec.imageUrl,
    signature,
    publishedAt: published.publishedAt ?? now,
    review: published.review,
  });
  return { ok: true, record: published, alreadyPublished: false };
}

// ---- admin review of near-duplicates ---------------------------------------------

export async function reviewNft(
  args: { contentId: string; decision: "approve" | "reject" }
): Promise<{ ok: true; record: NftRecord } | Failure> {
  const result = await updateRecord<NftRecord | "state" | null>(args.contentId, (cur) => {
    if (!cur) return { next: cur, result: null };
    if (cur.review !== "REVIEW_REQUIRED" || cur.status !== "UPLOADED") return { next: cur, result: "state" };
    const next: NftRecord =
      args.decision === "approve" ? { ...cur, review: "APPROVED" } : { ...cur, review: "REJECTED", status: "REJECTED", failReason: "Rejected in review" };
    return { next, result: next };
  });
  if (result === null) return fail("NOT_FOUND", "No such upload.", 404);
  if (result === "state") return fail("BAD_STATE", "Only uploads waiting for review can be reviewed.", 409);
  if (args.decision === "reject") {
    await releaseImage(result.contentId);
    await releaseSlot(result.themeId, result.wallet, result.contentId);
  }
  return { ok: true, record: result };
}
