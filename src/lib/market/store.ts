import { docRead, docUpdate } from "@/lib/storage/store";
import type { SaleKind, Transfer } from "./split";

/**
 * Marketplace storage (server only). Everything that decides "may this
 * succeed?" is one atomic update on one document:
 *  - `asset/<asset>`: at most ONE active listing per NFT, and how many sales it has had;
 *  - `sale/<id>`: a sale moves PENDING -> COMPLETED exactly once, so a sale is never counted twice;
 *  - the per-theme sales list is append-only and de-duplicated by transaction signature.
 */

export type ListingStatus = "PENDING" | "ACTIVE" | "SOLD" | "CANCELLED";

export type Listing = {
  listingId: string;
  assetAddress: string;
  contentId: string;
  themeId: number;
  seller: string;
  creator: string;
  name: string;
  imageUrl: string;
  priceLamports: number;
  expiresAt: number;
  nonce: string;
  domain: string;
  /** The exact text the seller signed. */
  message: string;
  messageSignature?: string;
  status: ListingStatus;
  createdAt: number;
  activatedAt?: number;
  closedAt?: number;
  closedReason?: string;
  saleId?: string;
};

export type SaleStatus = "PENDING" | "COMPLETED";

export type Sale = {
  saleId: string;
  listingId: string;
  assetAddress: string;
  themeId: number;
  buyer: string;
  seller: string;
  creator: string;
  kind: SaleKind;
  priceLamports: number;
  feeLamports: number;
  royaltyLamports: number;
  sellerLamports: number;
  payments: Transfer[];
  lastValidBlockHeight: number;
  status: SaleStatus;
  signature?: string;
  createdAt: number;
  completedAt?: number;
};

const listingPath = (id: string) => `market/listings/${id}.json`;
const assetPath = (asset: string) => `market/asset/${asset}.json`;
const salePath = (id: string) => `market/sale/${id}.json`;
const activePath = (themeId: number) => `market/active/${themeId}.json`;
const salesPath = (themeId: number) => `market/sales/${themeId}.json`;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---- per-asset gate --------------------------------------------------------------

export type AssetGate = {
  version: 1;
  /** "pending" while a listing is being set up (short lease), "active" once it can be sold. */
  state: "none" | "pending" | "active";
  listingId: string | null;
  /** Lease end while pending; the listing's expiry while active. */
  until: number;
  salesCount: number;
};
const EMPTY_GATE: AssetGate = { version: 1, state: "none", listingId: null, until: 0, salesCount: 0 };
const busy = (g: AssetGate, now: number) => g.state !== "none" && g.until > now;

export async function getGate(asset: string): Promise<AssetGate> {
  if (!ADDRESS.test(asset)) return EMPTY_GATE;
  return docRead<AssetGate>(assetPath(asset), EMPTY_GATE);
}

/**
 * Takes the asset's single listing slot. An ACTIVE listing blocks it; an unfinished (pending) one can be
 * replaced — the caller has already proven on-chain that they own the asset, so only its owner gets here.
 */
export async function reserveAsset(asset: string, listingId: string, until: number, now: number): Promise<{ ok: true; salesCount: number } | { ok: false }> {
  return docUpdate<AssetGate, { ok: true; salesCount: number } | { ok: false }>(assetPath(asset), EMPTY_GATE, (g) => {
    if (busy(g, now) && g.state === "active") return { next: g, result: { ok: false } };
    return { next: { ...g, state: "pending", listingId, until }, result: { ok: true, salesCount: g.salesCount } };
  });
}

export async function activateAsset(asset: string, listingId: string, until: number): Promise<boolean> {
  return docUpdate<AssetGate, boolean>(assetPath(asset), EMPTY_GATE, (g) => {
    if (g.listingId !== listingId || g.state === "none") return { next: g, result: false };
    return { next: { ...g, state: "active", until }, result: true };
  });
}

export async function releaseAsset(asset: string, listingId: string): Promise<void> {
  await docUpdate<AssetGate, void>(assetPath(asset), EMPTY_GATE, (g) => ({
    next: g.listingId === listingId ? { ...g, state: "none", listingId: null, until: 0 } : g,
    result: undefined,
  }));
}

// ---- listings -------------------------------------------------------------------------

export async function getListing(id: string): Promise<Listing | null> {
  if (!ID.test(id)) return null;
  return docRead<Listing | null>(listingPath(id), null);
}

export async function saveListing(l: Listing): Promise<void> {
  await docUpdate<Listing | null, void>(listingPath(l.listingId), null, () => ({ next: l, result: undefined }));
}

export async function updateListing<R>(id: string, mutate: (l: Listing | null) => { next: Listing | null; result: R }): Promise<R> {
  if (!ID.test(id)) throw new Error("Bad listing id.");
  return docUpdate<Listing | null, R>(listingPath(id), null, mutate);
}

// ---- the public list of things for sale ---------------------------------------------------

export type ActiveItem = { listingId: string; assetAddress: string; contentId: string; seller: string; priceLamports: number; expiresAt: number };
type ActiveDoc = { version: 1; items: ActiveItem[] };
const EMPTY_ACTIVE: ActiveDoc = { version: 1, items: [] };

export async function addActive(themeId: number, item: ActiveItem): Promise<void> {
  await docUpdate<ActiveDoc, void>(activePath(themeId), EMPTY_ACTIVE, (d) => ({
    next: { ...d, items: [...d.items.filter((i) => i.assetAddress !== item.assetAddress), item] },
    result: undefined,
  }));
}

export async function removeActive(themeId: number, listingId: string): Promise<void> {
  await docUpdate<ActiveDoc, void>(activePath(themeId), EMPTY_ACTIVE, (d) => ({
    next: { ...d, items: d.items.filter((i) => i.listingId !== listingId) },
    result: undefined,
  }));
}

/** Listings that can still be bought right now (expired ones are filtered out by the clock, not by a cleanup job). */
export async function listActive(themeId: number, now: number): Promise<ActiveItem[]> {
  return (await docRead<ActiveDoc>(activePath(themeId), EMPTY_ACTIVE)).items.filter((i) => i.expiresAt > now);
}

// ---- sales ----------------------------------------------------------------------------------

export async function getSale(id: string): Promise<Sale | null> {
  if (!ID.test(id)) return null;
  return docRead<Sale | null>(salePath(id), null);
}

export async function saveSale(s: Sale): Promise<void> {
  await docUpdate<Sale | null, void>(salePath(s.saleId), null, () => ({ next: s, result: undefined }));
}

/** PENDING -> COMPLETED, once. Returns the completed sale, or null if it was already completed / doesn't exist. */
export async function completeSale(id: string, signature: string, now: number): Promise<Sale | null> {
  return docUpdate<Sale | null, Sale | null>(salePath(id), null, (s) => {
    if (!s || s.status !== "PENDING") return { next: s, result: null };
    const done: Sale = { ...s, status: "COMPLETED", signature, completedAt: now };
    return { next: done, result: done };
  });
}

type SalesDoc = { version: 1; items: Sale[] };
const EMPTY_SALES: SalesDoc = { version: 1, items: [] };

/** Appends a completed sale. Idempotent by sale id AND by transaction signature (one transaction is one sale). */
export async function recordSale(sale: Sale): Promise<void> {
  await docUpdate<SalesDoc, void>(salesPath(sale.themeId), EMPTY_SALES, (d) => ({
    next: d.items.some((s) => s.saleId === sale.saleId || (sale.signature && s.signature === sale.signature)) ? d : { ...d, items: [...d.items, sale] },
    result: undefined,
  }));
}

export async function listSales(themeId: number): Promise<Sale[]> {
  return (await docRead<SalesDoc>(salesPath(themeId), EMPTY_SALES)).items;
}

/** After a sale (call once, right after `completeSale` returned a sale): one more sale, and the listing's slot is free. */
export async function markAssetSold(asset: string, listingId: string): Promise<void> {
  await docUpdate<AssetGate, void>(assetPath(asset), EMPTY_GATE, (g) => ({
    next: g.listingId === listingId ? { ...g, state: "none", listingId: null, until: 0, salesCount: g.salesCount + 1 } : { ...g, salesCount: g.salesCount + 1 },
    result: undefined,
  }));
}

/** Claims a transaction signature for one sale. False if a DIFFERENT sale already used it (one transaction is one sale). */
export async function claimSignature(signature: string, saleId: string): Promise<boolean> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return false;
  return docUpdate<{ saleId: string } | null, boolean>(`market/sig/${signature}.json`, null, (cur) => {
    if (cur) return { next: cur, result: cur.saleId === saleId };
    return { next: { saleId }, result: true };
  });
}
