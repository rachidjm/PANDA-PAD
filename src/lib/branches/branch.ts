import { cleanText } from "@/lib/nft/metadata";
import type { Theme } from "@/lib/themes/theme";
import { BRANCH_CONFIG as C } from "./config";

/**
 * Branch rules — pure. Hierarchy: THEME -> BRANCH -> NFT. A branch belongs to one creator, who alone decides
 * (explicitly, by listing them) who else may add NFTs; nobody can take one over. The parent theme is never modified.
 */

export const BRANCH_STATUSES = ["ACTIVE", "PAUSED", "CLOSED"] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export type EligibilitySnapshot = { uniqueBuyers: number; volumeLamports: number; configVersion: string; evaluatedAt: number };

export type Branch = {
  branchId: number;
  slug: string;
  themeId: number;
  themeSlug: string;
  themeTitle: string;
  title: string;
  description: string;
  creator: string;
  /** Wallets the creator explicitly allowed to add NFTs. Never includes the creator. */
  contributors: string[];
  status: BranchStatus;
  /** The creator's best-selling NFT in the theme when the branch was opened (the "successful NFT" it continues). */
  rootAsset: string | null;
  /** What the creator had achieved when the branch was opened, for the record. */
  eligibility: EligibilitySnapshot;
  createdAt: number;
  updatedAt: number;
};

export type Check = { ok: true } | { ok: false; reason: string };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (s: unknown): s is string => typeof s === "string" && ADDRESS.test(s);

// ---- text ------------------------------------------------------------------------------------------

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Cleaned title/description, or an error. The title becomes the prefix of every NFT name ("Title #001"), so `#` is not allowed. */
export function validateBranchTexts(input: { title: unknown; description: unknown }): { ok: true; title: string; description: string } | { ok: false; error: string } {
  if (typeof input.title !== "string" || typeof input.description !== "string") return { ok: false, error: "Title and description are required." };
  const title = cleanText(input.title);
  const description = cleanText(input.description);
  if (title.length < C.title.min || title.length > C.title.max) return { ok: false, error: `The title must be ${C.title.min}–${C.title.max} characters.` };
  if (title.includes("#")) return { ok: false, error: "The title can't contain #." };
  if (slugify(title).length < 2) return { ok: false, error: "The title needs letters or numbers." };
  if (description.length > C.description.max) return { ok: false, error: `The description can be at most ${C.description.max} characters.` };
  return { ok: true, title, description };
}

/** "Cyber Wolf #001". The serial is assigned by the server, in order. */
export function nftName(title: string, serial: number): string {
  return `${title} #${String(serial).padStart(3, "0")}`;
}

// ---- who may do what -----------------------------------------------------------------------------------

export const canManage = (b: Pick<Branch, "creator">, wallet: string) => b.creator === wallet;
export const mayAddNfts = (b: Pick<Branch, "creator" | "contributors">, wallet: string) => b.creator === wallet || b.contributors.includes(wallet);

/** May a branch be opened in this theme? The theme must have really started; it may be over (branches outlive themes). */
export function themeAllowsBranch(theme: Theme | null | undefined): Check {
  if (!theme) return { ok: false, reason: "This theme doesn't exist." };
  if (theme.status === "DRAFT" || theme.status === "SCHEDULED") return { ok: false, reason: "This theme hasn't started yet." };
  if (theme.status === "CANCELLED") return { ok: false, reason: "This theme was cancelled." };
  if (!C.branchesOutliveTheme && theme.status !== "ACTIVE") return { ok: false, reason: "Branches can only be opened while the theme is active." };
  return { ok: true };
}

/** The one gate every "add an NFT to a branch" path calls (upload and prepare). The theme's own schedule is NOT consulted. */
export function branchMintDecision(branch: Branch | null | undefined, theme: Theme | null | undefined, wallet: string): Check {
  if (!branch) return { ok: false, reason: "This branch doesn't exist." };
  if (branch.status !== "ACTIVE") return { ok: false, reason: `This branch is ${branch.status.toLowerCase()} — no new NFTs can be added.` };
  if (!theme || theme.status === "CANCELLED" || theme.status === "DRAFT") return { ok: false, reason: "The theme of this branch is not available." };
  if (!mayAddNfts(branch, wallet)) return { ok: false, reason: "Only the branch's creator and the contributors they added can add NFTs." };
  return { ok: true };
}

// ---- status ---------------------------------------------------------------------------------------------

export type BranchActor = "creator" | "admin";

/** ACTIVE <-> PAUSED is an admin decision (e.g. abuse); a creator can close their own branch for good; CLOSED is final. */
export function canTransitionBranch(from: BranchStatus, to: BranchStatus, actor: BranchActor): Check {
  if (from === to) return { ok: false, reason: `Already ${from.toLowerCase()}.` };
  if (from === "CLOSED") return { ok: false, reason: "A closed branch can't be reopened." };
  if (to === "CLOSED") return { ok: true };
  if (actor !== "admin") return { ok: false, reason: "Only an admin can pause or resume a branch." };
  return { ok: true };
}

// ---- contributors ---------------------------------------------------------------------------------------

export function addContributor(b: Branch, wallet: unknown): { ok: true; contributors: string[] } | { ok: false; error: string } {
  if (!isAddress(wallet)) return { ok: false, error: "That isn't a valid wallet address." };
  if (wallet === b.creator) return { ok: false, error: "The creator can already add NFTs." };
  if (b.contributors.includes(wallet)) return { ok: false, error: "That wallet is already a contributor." };
  if (b.contributors.length >= C.maxContributors) return { ok: false, error: `A branch can have at most ${C.maxContributors} contributors.` };
  return { ok: true, contributors: [...b.contributors, wallet] };
}

export function removeContributor(b: Branch, wallet: unknown): { ok: true; contributors: string[] } | { ok: false; error: string } {
  if (!isAddress(wallet) || !b.contributors.includes(wallet)) return { ok: false, error: "That wallet isn't a contributor." };
  return { ok: true, contributors: b.contributors.filter((w) => w !== wallet) };
}
