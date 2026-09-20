import type { AssetLike, ExpectedAsset } from "@/lib/nft/mint";
import { attributesOfRecord, verifyAsset } from "@/lib/nft/mint";
import { getRecord, NftRecord } from "@/lib/nft/store";
import type { Failure } from "@/lib/nft/service";
import { MARKET_CONFIG } from "./config";
import { computeSplit, saleKind, SaleKind, saleTransfers, Split, Transfer } from "./split";
import { buildListingMessage, validateTerms } from "./terms";
import { verifySaleTx, ParsedTxLike, BuiltTx } from "./chain";
import {
  activateAsset,
  addActive,
  claimSignature,
  completeSale,
  getGate,
  getListing,
  getSale,
  Listing,
  listActive,
  listSales,
  markAssetSold,
  recordSale,
  releaseAsset,
  removeActive,
  reserveAsset,
  saveListing,
  saveSale,
  Sale,
  updateListing,
} from "./store";

/**
 * The marketplace rules. All I/O is injected, so every rule below is tested
 * without a chain. What it guarantees:
 *
 *  - only the on-chain OWNER can list, and only an asset that still passes the full
 *    safe-asset check (no hidden plugins that could claw it back or block transfers);
 *  - a listing is only sellable while the seller's SIGNED terms still verify — a price
 *    edited in the database, or a listing the seller never made, can't produce a sale;
 *  - one active listing per NFT; primary vs secondary is decided from the NFT's own
 *    history, never from a client field;
 *  - the sale price is split exactly (seller / creator royalty / PANDA fee) and the
 *    landed transaction is verified against the same list of payments;
 *  - a sale is recorded ONLY after that verification, once, and one transaction can
 *    never count as two sales — so volume and prices are real, never wash-inflated.
 */

export type MarketDeps = {
  now: () => number;
  newId: () => string;
  /** PANDA's market authority public key (the delegate the seller approves). */
  marketAuthority: string;
  treasury: string;
  /** The site's domain, bound into what the seller signs. */
  domain: string;
  /** NFT_SECONDARY: may NFTs that have changed hands, or that aren't the creator's first sale, be traded? */
  allowSecondary: boolean;
  fetchAsset: (asset: string) => Promise<AssetLike | null>;
  buildListTx: (seller: string, asset: string) => Promise<BuiltTx>;
  buildCancelTx: (seller: string, asset: string) => Promise<BuiltTx>;
  buildSaleTx: (buyer: string, asset: string, payments: Transfer[]) => Promise<BuiltTx>;
  getParsedTx: (signature: string) => Promise<ParsedTxLike | null>;
  recentSignatures: (asset: string, limit: number) => Promise<string[]>;
  verifySignature: (message: string, signatureBase58: string, wallet: string) => boolean;
  alert: (event: string, details: Record<string, unknown>) => Promise<void>;
};

const fail = (code: string, error: string, status: number): Failure => ({ ok: false, code, error, status });
const PENDING_LEASE_MS = 10 * 60_000;

const expectedFor = (rec: NftRecord, owner: string): ExpectedAsset => ({
  assetAddress: rec.assetAddress as string,
  owner,
  creator: rec.wallet,
  name: rec.name,
  uri: rec.metadataUri,
  royaltyBps: rec.royaltyBps,
  attributes: attributesOfRecord(rec),
});

const splitFor = (price: number, royaltyBps: number, creator: string, kind: SaleKind): Split =>
  computeSplit({ priceLamports: price, feeBps: MARKET_CONFIG.feeBps, royaltyBps, creators: [{ address: creator, percentage: 100 }], kind });

// ---- 1. list -----------------------------------------------------------------------

export async function prepareListing(
  deps: MarketDeps,
  args: { wallet: string; contentId: string; priceLamports: unknown; expiresAt: unknown }
): Promise<{ ok: true; listingId: string; message: string; transactionBase64: string; lastValidBlockHeight: number; kind: SaleKind; preview: Split } | Failure> {
  const now = deps.now();
  const rec = await getRecord(args.contentId);
  if (!rec || rec.status !== "PUBLISHED" || !rec.assetAddress) return fail("NOT_FOUND", "No such NFT.", 404);

  const termsError = validateTerms({ priceLamports: args.priceLamports, expiresAt: args.expiresAt }, now);
  if (termsError) return fail("BAD_TERMS", termsError, 400);
  const priceLamports = args.priceLamports as number;
  const expiresAt = args.expiresAt as number;

  const asset = await deps.fetchAsset(rec.assetAddress);
  if (!asset) return fail("NOT_FOUND", "That NFT wasn't found on-chain.", 404);
  const problem = verifyAsset(asset, expectedFor(rec, args.wallet), { marketAuthority: deps.marketAuthority });
  if (problem === "owner differs") return fail("NOT_OWNER", "You don't own this NFT.", 403);
  if (problem) {
    await deps.alert("Listing refused: asset failed the safe-asset check", { asset: rec.assetAddress, problem });
    return fail("UNSAFE_ASSET", "This NFT can't be sold on PANDA's market.", 409);
  }

  const gate = await getGate(rec.assetAddress);
  const kind = saleKind({ seller: args.wallet, creator: rec.wallet, priorSales: gate.salesCount });
  if (kind === "secondary" && !deps.allowSecondary) return fail("SECONDARY_DISABLED", "Reselling isn't open yet.", 403);

  const listingId = deps.newId();
  const reserved = await reserveAsset(rec.assetAddress, listingId, now + PENDING_LEASE_MS, now);
  if (!reserved.ok) return fail("ALREADY_LISTED", "This NFT is already listed.", 409);

  const nonce = deps.newId();
  const message = buildListingMessage({ domain: deps.domain, asset: rec.assetAddress, seller: args.wallet, priceLamports, expiresAt, nonce });
  const listing: Listing = {
    listingId,
    assetAddress: rec.assetAddress,
    contentId: rec.contentId,
    themeId: rec.themeId,
    seller: args.wallet,
    creator: rec.wallet,
    name: rec.name,
    imageUrl: rec.imageUrl,
    priceLamports,
    expiresAt,
    nonce,
    domain: deps.domain,
    message,
    status: "PENDING",
    createdAt: now,
  };
  await saveListing(listing);

  let built: BuiltTx;
  try {
    built = await deps.buildListTx(args.wallet, rec.assetAddress);
  } catch (err) {
    await releaseAsset(rec.assetAddress, listingId);
    await deps.alert("Couldn't build the listing transaction", { asset: rec.assetAddress, error: String(err).slice(0, 200) });
    return fail("ERROR", "Couldn't prepare the listing — try again.", 503);
  }
  return {
    ok: true,
    listingId,
    message,
    transactionBase64: built.transactionBase64,
    lastValidBlockHeight: built.lastValidBlockHeight,
    kind,
    preview: splitFor(priceLamports, rec.royaltyBps, rec.wallet, kind),
  };
}

export async function confirmListing(
  deps: MarketDeps,
  args: { wallet: string; listingId: string; messageSignature: unknown }
): Promise<{ ok: true; listing: Listing; alreadyActive: boolean } | Failure> {
  const now = deps.now();
  const l = await getListing(args.listingId);
  if (!l || l.seller !== args.wallet) return fail("NOT_FOUND", "No such listing.", 404);
  if (l.status === "ACTIVE") return { ok: true, listing: l, alreadyActive: true };
  if (l.status !== "PENDING") return fail("BAD_STATE", `This listing is ${l.status.toLowerCase()}.`, 409);
  if (now >= l.expiresAt) return fail("EXPIRED", "This listing has expired.", 409);
  if (typeof args.messageSignature !== "string" || !deps.verifySignature(l.message, args.messageSignature, args.wallet)) {
    return fail("BAD_SIGNATURE", "The listing terms weren't signed by your wallet.", 400);
  }

  const rec = await getRecord(l.contentId);
  if (!rec || !rec.assetAddress) return fail("NOT_FOUND", "No such NFT.", 404);
  const asset = await deps.fetchAsset(rec.assetAddress);
  if (!asset) return fail("PENDING", "The NFT isn't visible on-chain yet — check again shortly.", 202);
  const problem = verifyAsset(asset, expectedFor(rec, args.wallet), { marketAuthority: deps.marketAuthority, requireMarketDelegate: true });
  if (problem?.includes("not approved")) return fail("PENDING", "Waiting for your approval transaction to confirm — check again shortly.", 202);
  if (problem) return fail("UNSAFE_ASSET", "This NFT can't be sold on PANDA's market.", 409);

  const activated = await updateListing<Listing | null>(l.listingId, (cur) => {
    if (!cur || cur.status !== "PENDING") return { next: cur, result: cur && cur.status === "ACTIVE" ? cur : null };
    const next: Listing = { ...cur, status: "ACTIVE", messageSignature: args.messageSignature as string, activatedAt: now };
    return { next, result: next };
  });
  if (!activated) return fail("BAD_STATE", "This listing can't be activated.", 409);
  if (!(await activateAsset(l.assetAddress, l.listingId, l.expiresAt))) return fail("CONFLICT", "This NFT was listed by someone else in the meantime.", 409);
  await addActive(l.themeId, { listingId: l.listingId, assetAddress: l.assetAddress, contentId: l.contentId, seller: l.seller, priceLamports: l.priceLamports, expiresAt: l.expiresAt });
  return { ok: true, listing: activated, alreadyActive: false };
}

// ---- 2. buy -----------------------------------------------------------------------

export async function prepareBuy(
  deps: MarketDeps,
  args: { buyer: string; listingId: string }
): Promise<{ ok: true; saleId: string; transactionBase64: string; lastValidBlockHeight: number; kind: SaleKind; split: Split; payments: Transfer[]; name: string } | Failure> {
  const now = deps.now();
  const l = await getListing(args.listingId);
  if (!l) return fail("NOT_FOUND", "No such listing.", 404);
  if (l.status !== "ACTIVE") return fail("NOT_FOR_SALE", "This NFT isn't for sale any more.", 409);
  if (now >= l.expiresAt) return fail("EXPIRED", "This listing has expired.", 409);
  if (l.seller === args.buyer) return fail("OWN_LISTING", "You can't buy your own NFT.", 400);

  // Tamper check: the terms must still be exactly what the seller signed.
  const recomputed = buildListingMessage({ domain: l.domain, asset: l.assetAddress, seller: l.seller, priceLamports: l.priceLamports, expiresAt: l.expiresAt, nonce: l.nonce });
  if (recomputed !== l.message || !l.messageSignature || !deps.verifySignature(l.message, l.messageSignature, l.seller)) {
    await deps.alert("Listing failed its signature check — NOT sold", { listingId: l.listingId, asset: l.assetAddress });
    return fail("LISTING_INVALID", "This listing can't be verified, so it can't be bought.", 409);
  }

  const rec = await getRecord(l.contentId);
  if (!rec || !rec.assetAddress) return fail("NOT_FOUND", "No such NFT.", 404);
  const asset = await deps.fetchAsset(l.assetAddress);
  if (!asset) return fail("LISTING_INVALID", "This NFT can't be found on-chain right now.", 409);
  const problem = verifyAsset(asset, expectedFor(rec, l.seller), { marketAuthority: deps.marketAuthority, requireMarketDelegate: true });
  if (problem) {
    if (problem === "owner differs" || problem.includes("not approved")) {
      // The seller moved it or took their approval back: the listing is stale, close it.
      await closeListing(l, "CANCELLED", "stale: " + problem, now);
      return fail("NOT_FOR_SALE", "This NFT isn't for sale any more.", 409);
    }
    await deps.alert("Sale refused: asset failed the safe-asset check", { asset: l.assetAddress, problem });
    return fail("UNSAFE_ASSET", "This NFT can't be traded on PANDA's market.", 409);
  }

  const gate = await getGate(l.assetAddress);
  const kind = saleKind({ seller: l.seller, creator: l.creator, priorSales: gate.salesCount });
  if (kind === "secondary" && !deps.allowSecondary) return fail("SECONDARY_DISABLED", "Reselling isn't open yet.", 403);

  const split = splitFor(l.priceLamports, rec.royaltyBps, l.creator, kind);
  const payments = saleTransfers(split, { buyer: args.buyer, seller: l.seller, treasury: deps.treasury });

  let built: BuiltTx;
  try {
    built = await deps.buildSaleTx(args.buyer, l.assetAddress, payments);
  } catch (err) {
    await deps.alert("Couldn't build the sale transaction", { listingId: l.listingId, error: String(err).slice(0, 200) });
    return fail("ERROR", "Couldn't prepare the purchase — try again.", 503);
  }

  const saleId = deps.newId();
  await saveSale({
    saleId,
    listingId: l.listingId,
    assetAddress: l.assetAddress,
    themeId: l.themeId,
    buyer: args.buyer,
    seller: l.seller,
    creator: l.creator,
    kind,
    priceLamports: l.priceLamports,
    feeLamports: split.feeLamports,
    royaltyLamports: split.royaltyLamports,
    sellerLamports: split.sellerLamports,
    payments,
    lastValidBlockHeight: built.lastValidBlockHeight,
    status: "PENDING",
    createdAt: now,
  });
  return { ok: true, saleId, transactionBase64: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight, kind, split, payments, name: l.name };
}

export async function confirmSale(
  deps: MarketDeps,
  args: { buyer: string; saleId: string; signature?: unknown }
): Promise<{ ok: true; sale: Sale; alreadyCompleted: boolean } | Failure> {
  const now = deps.now();
  const sale = await getSale(args.saleId);
  if (!sale || sale.buyer !== args.buyer) return fail("NOT_FOUND", "No such purchase.", 404);
  if (sale.status === "COMPLETED") return { ok: true, sale, alreadyCompleted: true };

  const given = args.signature;
  if (given !== undefined && given !== null && (typeof given !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(given))) {
    return fail("BAD_SIGNATURE", "Invalid transaction signature.", 400);
  }
  // Without a signature (the tab was closed) look at the NFT's latest transactions instead.
  const candidates = typeof given === "string" ? [given] : await deps.recentSignatures(sale.assetAddress, 10);

  let found: string | null = null;
  let firstProblem: string | null = null;
  for (const signature of candidates) {
    const tx = await deps.getParsedTx(signature);
    if (!tx || !tx.meta) continue; // not landed (yet)
    const problem = verifySaleTx(tx, { buyer: sale.buyer, marketAuthority: deps.marketAuthority, asset: sale.assetAddress, payments: sale.payments });
    if (!problem) {
      found = signature;
      break;
    }
    firstProblem ??= problem;
  }
  if (!found) {
    if (typeof given === "string" && firstProblem) {
      await deps.alert("A submitted transaction is not the sale it claims to be", { saleId: sale.saleId, problem: firstProblem });
      return fail("MISMATCH", "That transaction isn't this purchase, so nothing was recorded.", 409);
    }
    return fail("PENDING", "The purchase isn't confirmed yet — check again shortly.", 202);
  }

  if (!(await claimSignature(found, sale.saleId))) return fail("SIGNATURE_USED", "That transaction already belongs to another sale.", 409);

  const done = await completeSale(sale.saleId, found, now);
  if (!done) return { ok: true, sale: (await getSale(sale.saleId)) ?? sale, alreadyCompleted: true }; // another request finished it first

  await markAssetSold(done.assetAddress, done.listingId);
  const listing = await getListing(done.listingId);
  if (listing) await closeListing(listing, "SOLD", "sold", now, done.saleId);
  await recordSale(done);
  return { ok: true, sale: done, alreadyCompleted: false };
}

// ---- 3. cancel ------------------------------------------------------------------------

export async function cancelListing(
  deps: MarketDeps,
  args: { wallet: string; listingId: string }
): Promise<{ ok: true; transactionBase64: string | null; lastValidBlockHeight: number | null } | Failure> {
  const l = await getListing(args.listingId);
  if (!l || l.seller !== args.wallet) return fail("NOT_FOUND", "No such listing.", 404);
  if (l.status !== "ACTIVE" && l.status !== "PENDING") return fail("BAD_STATE", `This listing is already ${l.status.toLowerCase()}.`, 409);

  // Stop selling immediately (the server just won't sign any more sales); taking the approval back on-chain follows.
  await closeListing(l, "CANCELLED", "cancelled by the seller", deps.now());
  try {
    const built = await deps.buildCancelTx(args.wallet, l.assetAddress);
    return { ok: true, transactionBase64: built.transactionBase64, lastValidBlockHeight: built.lastValidBlockHeight };
  } catch {
    return { ok: true, transactionBase64: null, lastValidBlockHeight: null };
  }
}

async function closeListing(l: Listing, status: "SOLD" | "CANCELLED", reason: string, now: number, saleId?: string): Promise<void> {
  await updateListing<null>(l.listingId, (cur) => {
    if (!cur || cur.status === "SOLD" || cur.status === "CANCELLED") return { next: cur, result: null };
    return { next: { ...cur, status, closedAt: now, closedReason: reason, ...(saleId ? { saleId } : {}) }, result: null };
  });
  if (status === "CANCELLED") await releaseAsset(l.assetAddress, l.listingId);
  await removeActive(l.themeId, l.listingId);
}

// ---- 4. read models: only real data -------------------------------------------------------

export type MarketStats = { listed: number; floorLamports: number | null; volumeLamports: number; sales: number; lastSaleLamports: number | null };

export async function marketStats(themeId: number, now: number): Promise<MarketStats> {
  const [active, sales] = await Promise.all([listActive(themeId, now), listSales(themeId)]);
  const done = sales.filter((s) => s.status === "COMPLETED");
  return {
    listed: active.length,
    floorLamports: active.length ? Math.min(...active.map((a) => a.priceLamports)) : null,
    volumeLamports: done.reduce((sum, s) => sum + s.priceLamports, 0),
    sales: done.length,
    lastSaleLamports: done.length ? done[done.length - 1].priceLamports : null,
  };
}
