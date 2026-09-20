import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import sharp from "sharp";
import { createTheme, getThemeById, getThemeBySlug, transitionTheme } from "@/lib/themes/store";
import { confirmMint, NftDeps, prepareMint, uploadNft } from "@/lib/nft/service";
import { getRecord, listBranchPublished, listPublished, reserveSlot } from "@/lib/nft/store";
import { attributesOfRecord } from "@/lib/nft/mint";
import { BRANCH_CONFIG as C } from "./config";
import { changeContributor, changeStatus } from "./service";
import { getBranchById, getBranchBySlug, insertBranch, setBranchStatus, takeSerial } from "./store";

const H = 3_600_000;
const SOL = 1_000_000_000;
let clock = Date.now();
const wallet = () => Keypair.generate().publicKey.toBase58();
const sig = () => "5".repeat(88);

// ---- fixtures (same style as the NFT service tests) ---------------------------------------------------------

const S = 600;
let artSeed = 5000;
function fresh(): Promise<Buffer> {
  let x = (++artSeed * 2654435761) >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const shapes = Array.from({ length: 16 }, () => {
    const c = `rgb(${Math.floor(r() * 256)},${Math.floor(r() * 256)},${Math.floor(r() * 256)})`;
    return r() < 0.5
      ? `<rect x="${Math.floor(r() * 500)}" y="${Math.floor(r() * 500)}" width="${40 + Math.floor(r() * 300)}" height="${40 + Math.floor(r() * 300)}" fill="${c}"/>`
      : `<circle cx="${Math.floor(r() * 600)}" cy="${Math.floor(r() * 600)}" r="${20 + Math.floor(r() * 180)}" fill="${c}"/>`;
  });
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#204060"/>${shapes.join("")}</svg>`)).png().toBuffer();
}

function makeDeps() {
  const files = new Map<string, Buffer>();
  const state = { chainProblem: null as string | null };
  let n = 0;
  const deps: NftDeps = {
    now: () => clock,
    newId: () => `content-${++n}-${Math.random().toString(36).slice(2, 10)}`,
    getTheme: getThemeBySlug,
    getThemeById,
    getBranch: getBranchBySlug,
    getBranchById,
    takeSerial,
    putFile: async (path, bytes) => {
      files.set(path, bytes);
      return `https://blob.test/${path}`;
    },
    buildTx: async () => ({ transactionBase64: "AAAA", blockhash: "h", lastValidBlockHeight: 99 }),
    signatureStatus: async () => "confirmed",
    verifyOnChain: async () => state.chainProblem,
    siteUrl: "https://panda.test",
    alert: async () => {},
  };
  return { deps, files, state };
}

let themeCounter = 0;
/** A theme that ran and is now CLOSED — the case branches exist for. */
async function closedTheme() {
  themeCounter++;
  const start = clock + 100 * H * themeCounter;
  const created = await createTheme(
    { slug: `bt-${themeCounter}`, title: `Branch Theme ${themeCounter}`, description: "Test theme.", rules: "Original only.", startTime: start, endTime: start + 24 * H, creationLimit: 1, royaltyBps: 500 },
    clock
  );
  assert.ok(created.ok);
  if (!created.ok) throw new Error();
  const t = created.theme;
  assert.ok((await transitionTheme(t.themeId, "SCHEDULED", clock)).ok);
  assert.ok((await transitionTheme(t.themeId, "ACTIVE", start)).ok);
  assert.ok((await transitionTheme(t.themeId, "CLOSING", start + 25 * H)).ok);
  assert.ok((await transitionTheme(t.themeId, "CLOSED", start + 26 * H)).ok);
  clock = start + 30 * H; // well after the theme ended
  return t;
}

async function branchIn(themeId: number, themeSlug: string, creator: string, title = "Cyber Wolf") {
  const r = await insertBranch(
    { themeId, themeSlug, themeTitle: "Branch Theme", title, description: "", creator, rootAsset: null, eligibility: { uniqueBuyers: 50, volumeLamports: SOL, configVersion: "v1", evaluatedAt: clock } },
    clock
  );
  assert.ok(r.ok);
  if (!r.ok) throw new Error();
  return r.branch;
}

const up = (h: ReturnType<typeof makeDeps>, w: string, branchSlug: string, file: Buffer, description = "A wolf") => uploadNft(h.deps, { wallet: w, branchSlug, name: "IGNORED", description, file });

// ---- tests ----------------------------------------------------------------------------------------------------

test("A BRANCH KEEPS MINTING AFTER ITS THEME CLOSED: named and numbered by the server, listed under the branch, theme untouched", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();

  const first = await up(h, c, branch.slug, await fresh());
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.record.name, "Cyber Wolf #001", "the client's name is ignored");
  assert.deepEqual([first.record.branchId, first.record.branchTitle, first.record.serial, first.record.themeId], [branch.branchId, "Cyber Wolf", 1, theme.themeId]);
  assert.equal(first.record.royaltyBps, 500, "the parent theme's royalty applies");

  const second = await up(h, c, branch.slug, await fresh());
  assert.ok(second.ok && second.record.name === "Cyber Wolf #002");

  // The stored metadata carries the branch, and its attributes are exactly what will be checked on-chain.
  const meta = JSON.parse(h.files.get(`nft/metadata/${first.record.contentId}.json`)!.toString());
  assert.equal(meta.name, "Cyber Wolf #001");
  assert.equal(meta.external_url, `https://panda.test/branches/${branch.slug}`);
  assert.deepEqual(
    meta.attributes.map((a: { trait_type: string; value: string }) => [a.trait_type, a.value]),
    attributesOfRecord(first.record).map((a) => [a.key, a.value])
  );
  assert.ok(attributesOfRecord(first.record).some((a) => a.key === "Branch" && a.value === "Cyber Wolf"));

  const asset = Keypair.generate().publicKey.toBase58();
  const prep = await prepareMint(h.deps, { wallet: c, contentId: first.record.contentId, assetAddress: asset });
  assert.ok(prep.ok);
  if (prep.ok) assert.ok(prep.expected.attributes.some((a) => a.key === "Branch ID" && a.value === String(branch.branchId)), "the mint is verified against the branch attributes");
  assert.ok((await confirmMint(h.deps, { wallet: c, contentId: first.record.contentId, signature: sig() })).ok);

  assert.equal((await listBranchPublished(branch.branchId)).length, 1);
  assert.equal((await listBranchPublished(branch.branchId))[0].serial, 1);
  assert.equal((await listPublished(theme.themeId)).length, 0, "the theme's own list is never touched by a branch");
  assert.equal((await getThemeById(theme.themeId))?.status, "CLOSED", "the theme stays as it was");
});

test("NO HIJACKING: a stranger can't add NFTs; a contributor can once the creator lists them, and loses it when removed", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const friend = wallet();
  const stranger = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();

  const denied = await up(h, stranger, branch.slug, await fresh());
  assert.ok(!denied.ok && denied.code === "NOT_ALLOWED" && denied.status === 403);
  const notYet = await up(h, friend, branch.slug, await fresh());
  assert.ok(!notYet.ok && notYet.status === 403);

  assert.ok((await changeContributor(clock, { wallet: c, branchId: branch.branchId, action: "add", target: friend })).ok);
  const mine = await up(h, friend, branch.slug, await fresh());
  assert.ok(mine.ok, "a listed contributor may add NFTs");
  assert.equal(mine.ok && mine.record.wallet, friend);

  // Removed after uploading, before preparing: the prepare gate re-checks.
  assert.ok((await changeContributor(clock, { wallet: c, branchId: branch.branchId, action: "remove", target: friend })).ok);
  if (mine.ok) {
    const late = await prepareMint(h.deps, { wallet: friend, contentId: mine.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() });
    assert.ok(!late.ok && late.code === "BRANCH_CLOSED", "no longer allowed at prepare time");
  }
  const again = await up(h, friend, branch.slug, await fresh());
  assert.ok(!again.ok && again.status === 403);
});

test("a paused or closed branch, a cancelled theme and an unknown branch all refuse new NFTs", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();
  const okUp = await up(h, c, branch.slug, await fresh());
  assert.ok(okUp.ok);

  assert.ok((await changeStatus(clock, { branchId: branch.branchId, to: "PAUSED", actor: "admin" })).ok);
  const paused = await up(h, c, branch.slug, await fresh());
  assert.ok(!paused.ok && paused.code === "BRANCH_CLOSED");
  if (okUp.ok) {
    const p = await prepareMint(h.deps, { wallet: c, contentId: okUp.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() });
    assert.ok(!p.ok && p.code === "BRANCH_CLOSED", "an upload can't be prepared while the branch is paused");
  }
  assert.ok((await changeStatus(clock, { branchId: branch.branchId, to: "ACTIVE", actor: "admin" })).ok);
  assert.ok((await up(h, c, branch.slug, await fresh())).ok, "resumed");

  await setBranchStatus(branch.branchId, "CLOSED", clock);
  const closed = await up(h, c, branch.slug, await fresh());
  assert.ok(!closed.ok && closed.code === "BRANCH_CLOSED");

  const unknown = await up(h, c, "no-such-branch", await fresh());
  assert.ok(!unknown.ok && unknown.code === "NOT_FOUND" && unknown.status === 404);
});

test("limits: per wallet in a branch, and the branch's own size; refusals don't burn serial numbers", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();

  // Refused uploads (bad image / bad description) take no serial number.
  const badDesc = await up(h, c, branch.slug, await fresh(), "x".repeat(600));
  assert.ok(!badDesc.ok && badDesc.code === "BAD_TEXT");
  const junk = await uploadNft(h.deps, { wallet: c, branchSlug: branch.slug, name: "x", description: "d", file: new Uint8Array([1, 2, 3]) });
  assert.ok(!junk.ok && junk.code === "BAD_IMAGE");
  const first = await up(h, c, branch.slug, await fresh());
  assert.equal(first.ok && first.record.serial, 1, "still #001 after two refusals");

  // The wallet's own limit is a separate scope from the theme's slots.
  const filler = wallet();
  for (let i = 0; i < C.creationLimitPerWallet; i++) assert.equal(await reserveSlot(`b${branch.branchId}`, filler, `slot-${i}-xxxxxxxx`, C.creationLimitPerWallet, clock), "ok");
  await changeContributor(clock, { wallet: c, branchId: branch.branchId, action: "add", target: filler });
  const limited = await up(h, filler, branch.slug, await fresh());
  assert.ok(!limited.ok && limited.code === "LIMIT_REACHED");
  assert.equal(await reserveSlot(theme.themeId, filler, "theme-slot-xxxxxxxx", 1, clock), "ok", "the theme's slots are untouched by the branch's");

  // The branch's size.
  for (let i = 0; i < C.maxNftsPerBranch; i++) if ((await takeSerial(branch.branchId, C.maxNftsPerBranch)) === null) break;
  const full = await up(h, c, branch.slug, await fresh());
  assert.ok(!full.ok && full.code === "BRANCH_FULL" && full.status === 409);
});

test("theme NFTs are unchanged: a theme that is closed still refuses new theme NFTs even though its branch accepts them", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();
  const viaTheme = await uploadNft(h.deps, { wallet: c, themeSlug: theme.slug, name: "Nope", description: "d", file: await fresh() });
  assert.ok(!viaTheme.ok && viaTheme.code === "THEME_CLOSED");
  assert.ok((await up(h, c, branch.slug, await fresh())).ok);
  assert.equal((await getBranchById(branch.branchId))?.themeId, theme.themeId);
});

test("a mint that doesn't match the branch attributes on-chain is not published", async () => {
  const theme = await closedTheme();
  const c = wallet();
  const branch = await branchIn(theme.themeId, theme.slug, c);
  const h = makeDeps();
  const u = await up(h, c, branch.slug, await fresh());
  assert.ok(u.ok);
  if (!u.ok) return;
  assert.ok((await prepareMint(h.deps, { wallet: c, contentId: u.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() })).ok);
  h.state.chainProblem = "attribute Branch ID differs";
  const r = await confirmMint(h.deps, { wallet: c, contentId: u.record.contentId, signature: sig() });
  assert.ok(!r.ok && r.code === "MISMATCH");
  assert.equal((await getRecord(u.record.contentId))?.status, "REJECTED_ONCHAIN");
  assert.equal((await listBranchPublished(branch.branchId)).length, 0);
});
