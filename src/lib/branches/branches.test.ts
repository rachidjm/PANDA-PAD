import { test } from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@/lib/themes/theme";
import { addContributor, Branch, branchMintDecision, canManage, canTransitionBranch, mayAddNfts, nftName, removeContributor, slugify, themeAllowsBranch, validateBranchTexts } from "./branch";
import { BRANCH_CONFIG as C } from "./config";
import { evaluateEligibility, EligibilitySale } from "./eligibility";
import { BranchDeps, changeContributor, changeStatus, checkEligibility, createBranch } from "./service";
import { getBranchById, getBranchBySlug, insertBranch, listBranchesOfTheme, takeSerial } from "./store";

const H = 3_600_000;
const SOL = 1_000_000_000;
const now = 1_800_000_000_000;
// Cheap, unique, well-formed base58 addresses (real key generation is slow in this environment and only the format matters here).
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let addrCounter = 0;
const addr = () => {
  let n = ++addrCounter;
  let tail = "";
  while (n > 0) {
    tail += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length);
  }
  return `PandaTestAddress${"1".repeat(24)}${tail}`.slice(0, 40).padEnd(40, "1").slice(0, 34) + tail.padEnd(6, "1");
};
const asset = () => addr();

// ---- eligibility fixtures --------------------------------------------------------------------------------

let saleCounter = 0; // default sale times cycle through 40..19 days ago, so they are always old enough to count
const sale = (o: Partial<EligibilitySale> & { creator: string }): EligibilitySale => ({
  assetAddress: asset(),
  buyer: addr(),
  seller: o.creator,
  priceLamports: SOL / 20,
  status: "COMPLETED",
  ts: now - 40 * 24 * H + (saleCounter++ % 500) * H,
  ...o,
});
/** n genuine sales: a different buyer for a different NFT of the creator, none resold. */
const genuine = (creator: string, n: number, price = SOL / 20) => Array.from({ length: n }, () => sale({ creator, priceLamports: price }));
const ev = (creator: string, sales: EligibilitySale[], flagged: string[] = []) => evaluateEligibility({ creator, sales, now, flagged: new Set(flagged) });

test("ELIGIBLE: 60 genuine buyers of different NFTs, held, 3 SOL — meets every criterion", () => {
  const c = addr();
  const r = ev(c, genuine(c, 60));
  assert.equal(r.eligible, true);
  assert.equal(r.uniqueBuyers, 60);
  assert.equal(r.volumeLamports, 3 * SOL);
  assert.deepEqual(r.criteria.map((x) => [x.key, x.met]), [["uniqueBuyers", true], ["volume", true], ["noFlags", true]]);
  assert.deepEqual(r.excluded, { selfPurchase: 0, returnedOwner: 0, flagged: 0, heldTooShort: 0 });
  assert.equal(r.configVersion, "v1");
});

test("thresholds are exact: 49 buyers or just under 1 SOL is not enough", () => {
  const c = addr();
  assert.equal(ev(c, genuine(c, 49, SOL / 10)).eligible, false, "49 buyers");
  assert.equal(ev(c, genuine(c, 50, SOL / 10)).eligible, true, "50 buyers, 5 SOL");
  assert.equal(ev(c, genuine(c, 50, 19_999_999)).eligible, false, "50 buyers but 0.99999995 SOL");
  assert.equal(ev(c, genuine(c, 50, 20_000_000)).eligible, true, "exactly 1 SOL");
});

test("simple volume is not enough: one whale buying everything is a single buyer", () => {
  const c = addr();
  const whale = addr();
  const r = ev(c, Array.from({ length: 40 }, () => sale({ creator: c, buyer: whale, priceLamports: SOL })));
  assert.equal(r.uniqueBuyers, 1);
  assert.equal(r.volumeLamports, 40 * SOL);
  assert.equal(r.eligible, false);
});

test("self-purchases never count: the creator (or the seller) buying", () => {
  const c = addr();
  const alt = addr();
  const r = ev(c, [
    sale({ creator: c, buyer: c }),
    sale({ creator: c, buyer: alt, seller: alt }),
    ...genuine(c, 3),
  ]);
  assert.equal(r.excluded.selfPurchase, 2);
  assert.equal(r.uniqueBuyers, 3);
});

test("an NFT coming back to a previous owner is a wash pattern and doesn't count", () => {
  const c = addr();
  const [b, d] = [addr(), addr()];
  const a = asset();
  const r = ev(c, [
    sale({ creator: c, assetAddress: a, buyer: b, seller: c, ts: now - 20 * 24 * H }),
    sale({ creator: c, assetAddress: a, buyer: d, seller: b, ts: now - 15 * 24 * H }),
    sale({ creator: c, assetAddress: a, buyer: b, seller: d, ts: now - 10 * 24 * H }), // back to b
    sale({ creator: c, assetAddress: a, buyer: c, seller: b, ts: now - 5 * 24 * H }), // back to the creator
  ]);
  assert.equal(r.excluded.returnedOwner, 1);
  assert.equal(r.excluded.selfPurchase, 1);
  assert.equal(r.uniqueBuyers, 2, "b (first sale) and d");
});

test("abuse flags: a flagged buyer or seller doesn't count, and a flagged creator can't qualify at all", () => {
  const c = addr();
  const [badBuyer, badSeller, ok] = [addr(), addr(), addr()];
  const a = asset();
  const sales = [
    sale({ creator: c, buyer: badBuyer }),
    sale({ creator: c, assetAddress: a, buyer: badSeller, ts: now - 20 * 24 * H }),
    sale({ creator: c, assetAddress: a, buyer: ok, seller: badSeller, ts: now - 10 * 24 * H }),
    ...genuine(c, 60),
  ];
  const r = ev(c, sales, [badBuyer, badSeller]);
  assert.equal(r.excluded.flagged, 3, "the flagged buyer's sale, the flagged seller's own purchase, and the sale FROM the flagged seller");
  assert.equal(r.uniqueBuyers, 60, "none of the three flagged-involved sales counts; only the 60 genuine ones");
  const flaggedCreator = ev(c, genuine(c, 60), [c]);
  assert.equal(flaggedCreator.eligible, false);
  assert.equal(flaggedCreator.criteria.find((x) => x.key === "noFlags")?.met, false);
});

test("holding period: a quick flip doesn't count, and a purchase still inside the holding period doesn't count yet", () => {
  const c = addr();
  const [b, d, recent] = [addr(), addr(), addr()];
  const a = asset();
  const r = ev(c, [
    sale({ creator: c, assetAddress: a, buyer: b, ts: now - 10 * 24 * H }),
    sale({ creator: c, assetAddress: a, buyer: d, seller: b, ts: now - 10 * 24 * H + 2 * H }), // b resold after 2h
    sale({ creator: c, buyer: recent, ts: now - 3 * H }), // bought 3h ago, still held, not yet 24h
  ]);
  assert.equal(r.excluded.heldTooShort, 2, "b's sale (flipped) and the recent one");
  assert.equal(r.uniqueBuyers, 1, "d, who still holds it");

  const later = evaluateEligibility({ creator: c, sales: [sale({ creator: c, buyer: recent, ts: now - 3 * H })], now: now + 30 * H, flagged: new Set() });
  assert.equal(later.uniqueBuyers, 1, "the same sale counts once 24h have passed");
});

test("only completed sales of THIS creator count; junk prices are ignored", () => {
  const c = addr();
  const other = addr();
  const r = ev(c, [
    ...genuine(c, 2),
    ...genuine(other, 30),
    sale({ creator: c, status: "PENDING" }),
    sale({ creator: c, priceLamports: 0 }),
    sale({ creator: c, priceLamports: 1.5 }),
    sale({ creator: c, ts: NaN }),
  ]);
  assert.equal(r.uniqueBuyers, 2);
});

test("a buyer of several NFTs is one unique buyer but all their volume counts; the root NFT is the best seller", () => {
  const c = addr();
  const b = addr();
  const [a1, a2] = [asset(), asset()];
  const r = ev(c, [
    sale({ creator: c, assetAddress: a1, buyer: b, priceLamports: 1 * SOL }),
    sale({ creator: c, assetAddress: a2, buyer: b, priceLamports: 3 * SOL }),
  ]);
  assert.equal(r.uniqueBuyers, 1);
  assert.equal(r.volumeLamports, 4 * SOL);
  assert.equal(r.rootAsset, a2);
  assert.equal(ev(c, []).rootAsset, null);
});

test("FUZZ eligibility: the partition adds up, flags only ever reduce, and 'eligible' always means the criteria hold", () => {
  let seed = 11;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 200; run++) {
    const c = addr();
    const wallets = Array.from({ length: 12 }, addr);
    const assets = Array.from({ length: 6 }, asset);
    const sales: EligibilitySale[] = Array.from({ length: Math.floor(rnd() * 60) }, () =>
      sale({ creator: c, assetAddress: assets[Math.floor(rnd() * 6)], buyer: wallets[Math.floor(rnd() * 12)], seller: rnd() < 0.5 ? c : wallets[Math.floor(rnd() * 12)], ts: now - Math.floor(rnd() * 40 * 24) * H, priceLamports: 1 + Math.floor(rnd() * SOL) })
    );
    const base = ev(c, sales);
    const excludedTotal = Object.values(base.excluded).reduce((a, b) => a + b, 0);
    assert.ok(excludedTotal <= sales.length);
    assert.ok(base.uniqueBuyers <= sales.length - excludedTotal);
    assert.ok(base.volumeLamports <= sales.reduce((s, x) => s + x.priceLamports, 0));
    assert.equal(base.eligible, base.criteria.every((x) => x.met));
    const flaggedMore = ev(c, sales, wallets.slice(0, 3));
    assert.ok(flaggedMore.uniqueBuyers <= base.uniqueBuyers && flaggedMore.volumeLamports <= base.volumeLamports, "flagging wallets can only reduce what counts");
  }
});

// ---- branch rules ------------------------------------------------------------------------------------------

const theme = (status: Theme["status"], over: Partial<Theme> = {}): Theme => ({ themeId: 1, slug: "future-animals", title: "Future Animals", status, startTime: now - 10 * H, endTime: now - H, ...over }) as Theme;
const branchOf = (over: Partial<Branch> = {}): Branch => ({
  branchId: 1, slug: "cyber-wolf", themeId: 1, themeSlug: "future-animals", themeTitle: "Future Animals", title: "Cyber Wolf", description: "", creator: "Creator", contributors: [], status: "ACTIVE", rootAsset: null,
  eligibility: { uniqueBuyers: 50, volumeLamports: SOL, configVersion: "v1", evaluatedAt: now }, createdAt: now, updatedAt: now, ...over,
});

test("titles: bounded, cleaned, no '#', and NFT names are numbered by the server", () => {
  assert.deepEqual(validateBranchTexts({ title: "  Cyber   Wolf ", description: "d" }), { ok: true, title: "Cyber Wolf", description: "d" });
  for (const t of ["ab", "x".repeat(C.title.max + 1), "Cyber #1", "!!!", 5, null]) assert.equal(validateBranchTexts({ title: t, description: "" }).ok, false, String(t));
  assert.equal(validateBranchTexts({ title: "Fine title", description: "x".repeat(C.description.max + 1) }).ok, false);
  assert.equal(validateBranchTexts({ title: "Fine title", description: undefined }).ok, false);
  assert.equal(nftName("Cyber Wolf", 1), "Cyber Wolf #001");
  assert.equal(nftName("Cyber Wolf", 42), "Cyber Wolf #042");
  assert.equal(nftName("Cyber Wolf", 1234), "Cyber Wolf #1234");
  assert.ok(nftName("x".repeat(C.title.max), 9999).length <= 32, "always fits the NFT name limit");
  assert.equal(slugify("Cyber Wolf!"), "cyber-wolf");
  assert.equal(slugify("Ñandú Ünico"), "nandu-unico");
});

test("a branch outlives its theme: creation is allowed for started themes, even ended ones — not drafts or cancelled ones", () => {
  for (const s of ["ACTIVE", "CLOSING", "CLOSED", "ARCHIVED"] as const) assert.equal(themeAllowsBranch(theme(s)).ok, true, s);
  for (const s of ["DRAFT", "SCHEDULED", "CANCELLED"] as const) assert.equal(themeAllowsBranch(theme(s)).ok, false, s);
  assert.equal(themeAllowsBranch(null).ok, false);
});

test("PERMISSIONS ARE EXPLICIT: only the creator and listed contributors may add NFTs; only the creator manages", () => {
  const b = branchOf({ creator: "Creator", contributors: ["Friend"] });
  assert.ok(mayAddNfts(b, "Creator") && mayAddNfts(b, "Friend"));
  assert.equal(mayAddNfts(b, "Stranger"), false);
  assert.ok(canManage(b, "Creator"));
  assert.equal(canManage(b, "Friend"), false, "a contributor can add NFTs but can't manage");
  assert.equal(canManage(b, "Stranger"), false);
});

test("the mint gate ignores the theme's schedule but respects the branch's status and the theme's existence", () => {
  const ended = theme("CLOSED"); // its end time is long past
  const b = branchOf();
  assert.equal(branchMintDecision(b, ended, "Creator").ok, true, "theme closed, branch keeps going");
  assert.equal(branchMintDecision({ ...b, status: "PAUSED" }, ended, "Creator").ok, false);
  assert.equal(branchMintDecision({ ...b, status: "CLOSED" }, ended, "Creator").ok, false);
  assert.equal(branchMintDecision(b, theme("CANCELLED"), "Creator").ok, false);
  assert.equal(branchMintDecision(b, null, "Creator").ok, false);
  assert.equal(branchMintDecision(null, ended, "Creator").ok, false);
  assert.equal(branchMintDecision(b, ended, "Stranger").ok, false);
});

test("status transitions: a creator can only close; pausing/resuming is the admin's; closed is final", () => {
  assert.equal(canTransitionBranch("ACTIVE", "CLOSED", "creator").ok, true);
  assert.equal(canTransitionBranch("ACTIVE", "PAUSED", "creator").ok, false);
  assert.equal(canTransitionBranch("PAUSED", "ACTIVE", "creator").ok, false);
  assert.equal(canTransitionBranch("ACTIVE", "PAUSED", "admin").ok, true);
  assert.equal(canTransitionBranch("PAUSED", "ACTIVE", "admin").ok, true);
  assert.equal(canTransitionBranch("PAUSED", "CLOSED", "admin").ok, true);
  for (const to of ["ACTIVE", "PAUSED"] as const) assert.equal(canTransitionBranch("CLOSED", to, "admin").ok, false, "closed can't reopen");
  assert.equal(canTransitionBranch("ACTIVE", "ACTIVE", "admin").ok, false);
});

test("contributors: valid wallets only, no duplicates, not the creator, capped", () => {
  const friend = addr();
  const b = branchOf({ creator: "Creator" });
  const added = addContributor(b, friend);
  assert.ok(added.ok && added.contributors.includes(friend));
  assert.equal(addContributor(branchOf({ contributors: [friend] }), friend).ok, false, "duplicate");
  assert.equal(addContributor(b, "Creator").ok, false, "the creator is not a contributor");
  for (const bad of ["nope", 5, null, ""]) assert.equal(addContributor(b, bad).ok, false, String(bad));
  const full = branchOf({ contributors: Array.from({ length: C.maxContributors }, addr) });
  assert.equal(addContributor(full, addr()).ok, false, "cap");
  assert.equal(removeContributor(branchOf({ contributors: [friend] }), friend).ok, true);
  assert.equal(removeContributor(b, addr()).ok, false);
});

// ---- use cases (in-memory storage) --------------------------------------------------------------------------

let themeCounter = 100;
function fixture(over: { status?: Theme["status"]; sales?: EligibilitySale[]; flagged?: string[] } = {}) {
  const themeId = ++themeCounter;
  const t = theme(over.status ?? "CLOSED", { themeId, slug: `t-${themeId}`, title: `Theme ${themeId}` });
  const deps: BranchDeps = { now: () => now, getTheme: async (slug) => (slug === t.slug ? t : null), salesOfTheme: async () => over.sales ?? [], flaggedWallets: async () => new Set(over.flagged ?? []) };
  return { t, deps };
}

test("createBranch: not eligible -> refused with the numbers; eligible -> created; the server recomputes eligibility itself", async () => {
  const c = addr();
  const poor = fixture({ sales: genuine(c, 10) });
  const no = await createBranch(poor.deps, { wallet: c, themeSlug: poor.t.slug, title: "Cyber Wolf", description: "" });
  assert.ok(!no.ok && no.code === "NOT_ELIGIBLE" && no.status === 403 && no.eligibility?.uniqueBuyers === 10);
  assert.equal((await listBranchesOfTheme(poor.t.themeId)).length, 0);

  const rich = fixture({ sales: genuine(c, 60) });
  const yes = await createBranch(rich.deps, { wallet: c, themeSlug: rich.t.slug, title: "Cyber Wolf", description: "Wolves" });
  assert.ok(yes.ok);
  if (!yes.ok) return;
  assert.equal(yes.branch.creator, c);
  assert.equal(yes.branch.status, "ACTIVE");
  assert.deepEqual(yes.branch.contributors, []);
  assert.equal(yes.branch.eligibility.uniqueBuyers, 60);
  assert.ok(yes.branch.rootAsset);
  assert.equal((await getBranchBySlug(yes.branch.slug))?.branchId, yes.branch.branchId);

  // Somebody else with the same sales in the list still isn't eligible: the sales are the creator's, not theirs.
  const thief = await createBranch(rich.deps, { wallet: addr(), themeSlug: rich.t.slug, title: "Steal Wolf", description: "" });
  assert.ok(!thief.ok && thief.code === "NOT_ELIGIBLE");
});

test("createBranch: theme must exist and have started; bad text refused; one branch per creator per theme; slugs stay unique", async () => {
  const c = addr();
  const f = fixture({ sales: genuine(c, 60) });
  assert.ok(!(await createBranch(f.deps, { wallet: c, themeSlug: "nope", title: "Cyber Wolf", description: "" })).ok);
  const sched = fixture({ status: "SCHEDULED", sales: genuine(c, 60) });
  const s = await createBranch(sched.deps, { wallet: c, themeSlug: sched.t.slug, title: "Cyber Wolf", description: "" });
  assert.ok(!s.ok && s.code === "THEME_UNAVAILABLE");
  const bad = await createBranch(f.deps, { wallet: c, themeSlug: f.t.slug, title: "Bad #1", description: "" });
  assert.ok(!bad.ok && bad.code === "BAD_TEXT" && bad.status === 400);

  const first = await createBranch(f.deps, { wallet: c, themeSlug: f.t.slug, title: "Twin Name", description: "" });
  assert.ok(first.ok);
  const second = await createBranch(f.deps, { wallet: c, themeSlug: f.t.slug, title: "Another", description: "" });
  assert.ok(!second.ok && second.code === "THEME_LIMIT" && second.status === 409);

  const c2 = addr();
  const g = fixture({ sales: genuine(c2, 60) });
  const dup = await createBranch(g.deps, { wallet: c2, themeSlug: g.t.slug, title: "Twin Name", description: "" });
  assert.ok(dup.ok && first.ok && dup.branch.slug !== first.branch.slug, "the same title in another theme gets its own slug");
});

test("a creator is capped on open branches overall; closing one frees a place", async () => {
  const c = addr();
  const made: number[] = [];
  for (let i = 0; i < C.maxPerCreator; i++) {
    const f = fixture({ sales: genuine(c, 60) });
    const r = await createBranch(f.deps, { wallet: c, themeSlug: f.t.slug, title: `Branch ${i}x`, description: "" });
    assert.ok(r.ok);
    if (r.ok) made.push(r.branch.branchId);
  }
  const over = fixture({ sales: genuine(c, 60) });
  const denied = await createBranch(over.deps, { wallet: c, themeSlug: over.t.slug, title: "One too many", description: "" });
  assert.ok(!denied.ok && denied.code === "CREATOR_LIMIT");
  assert.ok((await changeStatus(now, { branchId: made[0], to: "CLOSED", actor: "creator", wallet: c })).ok);
  assert.ok((await createBranch(over.deps, { wallet: c, themeSlug: over.t.slug, title: "One too many", description: "" })).ok);
});

test("checkEligibility exposes the methodology numbers without creating anything", async () => {
  const c = addr();
  const f = fixture({ sales: genuine(c, 20) });
  const r = await checkEligibility(f.deps, { wallet: c, themeSlug: f.t.slug });
  assert.ok(r.ok && !r.eligibility.eligible && r.eligibility.criteria[0].actual === 20 && r.eligibility.criteria[0].required === 50);
  assert.equal((await listBranchesOfTheme(f.t.themeId)).length, 0);
});

test("contributors and status are managed atomically, and only by the right person", async () => {
  const c = addr();
  const f = fixture({ sales: genuine(c, 60) });
  const made = await createBranch(f.deps, { wallet: c, themeSlug: f.t.slug, title: "Managed", description: "" });
  assert.ok(made.ok);
  if (!made.ok) return;
  const id = made.branch.branchId;
  const friend = addr();

  const denied = await changeContributor(now, { wallet: addr(), branchId: id, action: "add", target: friend });
  assert.ok(!denied.ok && denied.status === 403, "a stranger can't add contributors");
  const ok = await changeContributor(now, { wallet: c, branchId: id, action: "add", target: friend });
  assert.ok(ok.ok && ok.branch.contributors.includes(friend));
  const contribCantManage = await changeContributor(now, { wallet: friend, branchId: id, action: "add", target: addr() });
  assert.ok(!contribCantManage.ok && contribCantManage.status === 403);
  assert.ok((await changeContributor(now, { wallet: c, branchId: id, action: "remove", target: friend })).ok);
  assert.equal((await changeContributor(now, { wallet: c, branchId: 99999, action: "add", target: friend })).ok, false);

  const creatorPause = await changeStatus(now, { branchId: id, to: "PAUSED", actor: "creator", wallet: c });
  assert.ok(!creatorPause.ok && creatorPause.code === "BAD_STATE");
  const strangerClose = await changeStatus(now, { branchId: id, to: "CLOSED", actor: "creator", wallet: addr() });
  assert.ok(!strangerClose.ok && strangerClose.status === 403);
  const adminPause = await changeStatus(now, { branchId: id, to: "PAUSED", actor: "admin" });
  assert.ok(adminPause.ok && adminPause.before === "ACTIVE");
  assert.equal((await getBranchById(id))?.status, "PAUSED");
  assert.ok((await changeStatus(now, { branchId: id, to: "ACTIVE", actor: "admin" })).ok);
  assert.ok((await changeStatus(now, { branchId: id, to: "CLOSED", actor: "creator", wallet: c })).ok);
  const reopen = await changeStatus(now, { branchId: id, to: "ACTIVE", actor: "admin" });
  assert.ok(!reopen.ok, "closed is final");
  const afterClose = await changeContributor(now, { wallet: c, branchId: id, action: "add", target: addr() });
  assert.ok(!afterClose.ok && afterClose.code === "BRANCH_CLOSED");
});

test("serial numbers: in order, never reused even when taken at the same time, and they stop at the branch's limit", async () => {
  const id = 900_001;
  assert.equal(await takeSerial(id, 5), 1);
  const rest = await Promise.all(Array.from({ length: 4 }, () => takeSerial(id, 5)));
  assert.deepEqual([...rest].sort(), [2, 3, 4, 5]);
  assert.equal(await takeSerial(id, 5), null, "full");
  assert.equal(await takeSerial(id, 5), null, "stays full");

  const many = await Promise.all(Array.from({ length: 30 }, () => takeSerial(900_002, 1000)));
  assert.equal(new Set(many).size, 30, "30 simultaneous takes, 30 different numbers");
});

test("insertBranch is atomic: racing creations by one creator can't get past the per-theme cap", async () => {
  const c = addr();
  const themeId = ++themeCounter;
  const mk = (n: number) => insertBranch({ themeId, themeSlug: "t", themeTitle: "T", title: `Race ${n}`, description: "", creator: c, rootAsset: null, eligibility: { uniqueBuyers: 50, volumeLamports: SOL, configVersion: "v1", evaluatedAt: now } }, now);
  const results = await Promise.all([1, 2, 3, 4, 5].map(mk));
  assert.equal(results.filter((r) => r.ok).length, C.maxPerCreatorPerTheme);
});
