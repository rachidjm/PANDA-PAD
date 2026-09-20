import type { Theme } from "@/lib/themes/theme";
import { addContributor, Branch, BranchActor, BranchStatus, canManage, canTransitionBranch, removeContributor, themeAllowsBranch, validateBranchTexts } from "./branch";
import { BRANCH_CONFIG } from "./config";
import { Eligibility, EligibilitySale, evaluateEligibility } from "./eligibility";
import { insertBranch, updateBranch } from "./store";

/**
 * The branch use cases. All I/O is injected, so every rule is tested without a network. What matters:
 *  - eligibility is ALWAYS recomputed here from verified sales — never taken from the request;
 *  - only the creator manages a branch; nobody can take one over or add NFTs to it without being listed;
 *  - the parent theme is only read, never changed.
 */

export type Failure = { ok: false; code: string; error: string; status: number; eligibility?: Eligibility };
const fail = (code: string, error: string, status: number, eligibility?: Eligibility): Failure => ({ ok: false, code, error, status, ...(eligibility ? { eligibility } : {}) });

export type BranchDeps = {
  now: () => number;
  getTheme: (slug: string) => Promise<Theme | null>;
  /** Completed and pending sales of the theme, as verified and stored by the market. */
  salesOfTheme: (themeId: number) => Promise<EligibilitySale[]>;
  /** Every wallet with an abuse status other than NORMAL. */
  flaggedWallets: () => Promise<Set<string>>;
};

/** How far this wallet is from being able to open a branch in this theme — shown to the creator with the methodology. */
export async function checkEligibility(deps: BranchDeps, args: { wallet: string; themeSlug: string }): Promise<{ ok: true; theme: Theme; eligibility: Eligibility } | Failure> {
  const theme = await deps.getTheme(args.themeSlug);
  const allowed = themeAllowsBranch(theme);
  if (!allowed.ok || !theme) return fail("THEME_UNAVAILABLE", allowed.ok ? "This theme doesn't exist." : allowed.reason, 409);
  const [sales, flagged] = await Promise.all([deps.salesOfTheme(theme.themeId), deps.flaggedWallets()]);
  return { ok: true, theme, eligibility: evaluateEligibility({ creator: args.wallet, sales, now: deps.now(), flagged }) };
}

export async function createBranch(
  deps: BranchDeps,
  args: { wallet: string; themeSlug: string; title: unknown; description: unknown }
): Promise<{ ok: true; branch: Branch } | Failure> {
  const texts = validateBranchTexts({ title: args.title, description: args.description });
  if (!texts.ok) return fail("BAD_TEXT", texts.error, 400);

  const checked = await checkEligibility(deps, { wallet: args.wallet, themeSlug: args.themeSlug });
  if (!checked.ok) return checked;
  const { theme, eligibility } = checked;
  if (!eligibility.eligible) return fail("NOT_ELIGIBLE", "You don't meet the requirements to open a branch in this theme yet.", 403, eligibility);

  const now = deps.now();
  const r = await insertBranch(
    {
      themeId: theme.themeId,
      themeSlug: theme.slug,
      themeTitle: theme.title,
      title: texts.title,
      description: texts.description,
      creator: args.wallet,
      rootAsset: eligibility.rootAsset,
      eligibility: { uniqueBuyers: eligibility.uniqueBuyers, volumeLamports: eligibility.volumeLamports, configVersion: eligibility.configVersion, evaluatedAt: now },
    },
    now
  );
  if (!r.ok) return fail(r.code, r.error, 409);
  return { ok: true, branch: r.branch };
}

type Change = { ok: true; branch: Branch } | Failure;

/** Adds or removes a contributor. Only the creator may; changes are atomic on the branch. */
export async function changeContributor(now: number, args: { wallet: string; branchId: number; action: "add" | "remove"; target: unknown }): Promise<Change> {
  const outcome = await updateBranch<Change>(args.branchId, (b) => {
    if (!b) return { next: b, result: fail("NOT_FOUND", "No such branch.", 404) };
    if (!canManage(b, args.wallet)) return { next: b, result: fail("NOT_ALLOWED", "Only the branch's creator can manage contributors.", 403) };
    if (b.status === "CLOSED") return { next: b, result: fail("BRANCH_CLOSED", "This branch is closed.", 409) };
    const r = args.action === "add" ? addContributor(b, args.target) : removeContributor(b, args.target);
    if (!r.ok) return { next: b, result: fail("BAD_REQUEST", r.error, 400) };
    const next = { ...b, contributors: r.contributors, updatedAt: now };
    return { next, result: { ok: true, branch: next } };
  });
  return outcome;
}

/** Changes a branch's status under the transition rules (a creator can only close; pausing and resuming are admin decisions). */
export async function changeStatus(now: number, args: { branchId: number; to: BranchStatus; actor: BranchActor; wallet?: string }): Promise<Change & { before?: BranchStatus }> {
  return updateBranch<Change & { before?: BranchStatus }>(args.branchId, (b) => {
    if (!b) return { next: b, result: fail("NOT_FOUND", "No such branch.", 404) };
    if (args.actor === "creator" && (!args.wallet || !canManage(b, args.wallet))) return { next: b, result: fail("NOT_ALLOWED", "Only the branch's creator can do that.", 403) };
    const check = canTransitionBranch(b.status, args.to, args.actor);
    if (!check.ok) return { next: b, result: fail("BAD_STATE", check.reason, 409) };
    const next: Branch = { ...b, status: args.to, updatedAt: now };
    return { next, result: { ok: true, branch: next, before: b.status } };
  });
}

export const BRANCH_LIMITS = BRANCH_CONFIG;
