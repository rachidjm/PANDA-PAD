import { docRead, docUpdate } from "@/lib/storage/store";
import { Branch, BranchStatus, EligibilitySnapshot, slugify } from "./branch";
import { BRANCH_CONFIG as C } from "./config";

/**
 * Storage for branches (server only): one index document updated atomically (so the caps and the unique slug can't be
 * raced past), plus a tiny counter document per branch that hands out NFT serial numbers in order.
 */

const INDEX = "branches/index.json";
const counterPath = (id: number) => `branches/counter/${id}.json`;

type IndexDoc = { version: 1; nextId: number; items: Branch[] };
const EMPTY: IndexDoc = { version: 1, nextId: 1, items: [] };

export async function listBranches(): Promise<Branch[]> {
  return (await docRead<IndexDoc>(INDEX, EMPTY)).items;
}
export async function getBranchBySlug(slug: string): Promise<Branch | null> {
  return (await listBranches()).find((b) => b.slug === slug) ?? null;
}
export async function getBranchById(id: number): Promise<Branch | null> {
  return (await listBranches()).find((b) => b.branchId === id) ?? null;
}
export async function listBranchesOfTheme(themeId: number): Promise<Branch[]> {
  return (await listBranches()).filter((b) => b.themeId === themeId);
}

export type NewBranchInput = {
  themeId: number;
  themeSlug: string;
  themeTitle: string;
  title: string;
  description: string;
  creator: string;
  rootAsset: string | null;
  eligibility: EligibilitySnapshot;
};

export type CreateResult = { ok: true; branch: Branch } | { ok: false; code: "THEME_LIMIT" | "CREATOR_LIMIT"; error: string };

/** Creates a branch if the creator is within their caps, in one atomic update; the slug is made unique. */
export async function insertBranch(input: NewBranchInput, now: number): Promise<CreateResult> {
  return docUpdate<IndexDoc, CreateResult>(INDEX, EMPTY, (doc) => {
    const open = doc.items.filter((b) => b.creator === input.creator && b.status !== "CLOSED");
    if (open.filter((b) => b.themeId === input.themeId).length >= C.maxPerCreatorPerTheme) {
      return { next: doc, result: { ok: false, code: "THEME_LIMIT", error: `You already have a branch in this theme (at most ${C.maxPerCreatorPerTheme}).` } };
    }
    if (open.length >= C.maxPerCreator) {
      return { next: doc, result: { ok: false, code: "CREATOR_LIMIT", error: `You can have at most ${C.maxPerCreator} open branches.` } };
    }
    const base = slugify(input.title) || "branch";
    const taken = new Set(doc.items.map((b) => b.slug));
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`.slice(0, 44);

    const branch: Branch = {
      branchId: doc.nextId,
      slug,
      themeId: input.themeId,
      themeSlug: input.themeSlug,
      themeTitle: input.themeTitle,
      title: input.title,
      description: input.description,
      creator: input.creator,
      contributors: [],
      status: "ACTIVE",
      rootAsset: input.rootAsset,
      eligibility: input.eligibility,
      createdAt: now,
      updatedAt: now,
    };
    return { next: { ...doc, nextId: doc.nextId + 1, items: [...doc.items, branch] }, result: { ok: true, branch } };
  });
}

/** Atomic read-modify-write of one branch. `mutate` returns the new branch (or the same one) and a result. */
export async function updateBranch<R>(id: number, mutate: (b: Branch | null) => { next: Branch | null; result: R }): Promise<R> {
  return docUpdate<IndexDoc, R>(INDEX, EMPTY, (doc) => {
    const cur = doc.items.find((b) => b.branchId === id) ?? null;
    const { next, result } = mutate(cur);
    if (!next || next === cur) return { next: doc, result };
    return { next: { ...doc, items: doc.items.map((b) => (b.branchId === id ? next : b)) }, result };
  });
}

export async function setBranchStatus(id: number, status: BranchStatus, now: number): Promise<void> {
  await updateBranch<void>(id, (b) => ({ next: b ? { ...b, status, updatedAt: now } : b, result: undefined }));
}

/** The next NFT serial of a branch (1, 2, 3, ...), or null once `max` NFTs have been numbered. A serial is never reused, so an abandoned upload leaves a gap. */
export async function takeSerial(branchId: number, max: number): Promise<number | null> {
  return docUpdate<{ next: number }, number | null>(counterPath(branchId), { next: 1 }, (c) => {
    if (c.next > max) return { next: c, result: null };
    return { next: { next: c.next + 1 }, result: c.next };
  });
}
