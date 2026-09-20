import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import sharp from "sharp";
import { createTheme, getThemeBySlug, transitionTheme } from "@/lib/themes/store";
import { NewThemeInput } from "@/lib/themes/theme";
import { confirmMint, NftDeps, prepareMint, REPREPARE_AFTER_MS, reviewNft, uploadNft } from "./service";
import { getRecord, listPublished, reserveSlot } from "./store";

const H = 3_600_000;
let clock = Date.now();
const wallet = () => Keypair.generate().publicKey.toBase58();
const sig = () => "5".repeat(88);

// ---- fixtures ------------------------------------------------------------------

const S = 600;
const draw = (body: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#204060"/>${body}</svg>`)).png().toBuffer();

// Every call returns artwork that is unrelated to every other call (seeded random shapes), so tests
// don't trip the duplicate / near-duplicate detector by accident.
let artSeed = 1000;
function fresh(): Promise<Buffer> {
  let x = (++artSeed * 2654435761) >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const shapes = Array.from({ length: 16 }, () => {
    const c = `rgb(${Math.floor(r() * 256)},${Math.floor(r() * 256)},${Math.floor(r() * 256)})`;
    return r() < 0.5
      ? `<rect x="${Math.floor(r() * 500)}" y="${Math.floor(r() * 500)}" width="${40 + Math.floor(r() * 300)}" height="${40 + Math.floor(r() * 300)}" fill="${c}"/>`
      : `<circle cx="${Math.floor(r() * 600)}" cy="${Math.floor(r() * 600)}" r="${20 + Math.floor(r() * 180)}" fill="${c}"/>`;
  });
  return draw(shapes.join(""));
}

// ---- harness ---------------------------------------------------------------------

type Harness = ReturnType<typeof makeDeps>;
function makeDeps(over: Partial<NftDeps> = {}) {
  const alerts: string[] = [];
  const files: string[] = [];
  const state = { txStatus: "confirmed" as "confirmed" | "failed" | "pending", chainProblem: null as string | null, builds: 0 };
  let n = 0;
  const deps: NftDeps = {
    now: () => clock,
    newId: () => `content-${++n}-${Math.random().toString(36).slice(2, 10)}`,
    getTheme: getThemeBySlug,
    putFile: async (path) => {
      files.push(path);
      return `https://blob.test/${path}`;
    },
    buildTx: async () => {
      state.builds++;
      return { transactionBase64: "AAAA", blockhash: "h", lastValidBlockHeight: 99 };
    },
    signatureStatus: async () => state.txStatus,
    verifyOnChain: async () => state.chainProblem,
    siteUrl: "https://panda.test",
    alert: async (e) => {
      alerts.push(e);
    },
    ...over,
  };
  return { deps, alerts, files, state };
}

let themeCounter = 0;
async function activeTheme(over: Partial<NewThemeInput> = {}) {
  themeCounter++;
  const created = await createTheme(
    {
      slug: `theme-${themeCounter}`,
      title: `Theme ${themeCounter}`,
      description: "A test theme for NFTs.",
      rules: "Original artwork only.",
      startTime: clock + 100 * H * themeCounter,
      endTime: clock + 100 * H * themeCounter + 24 * H,
      creationLimit: 2,
      royaltyBps: 500,
      ...over,
    },
    clock
  );
  assert.ok(created.ok);
  if (!created.ok) throw new Error();
  const start = created.theme.startTime;
  assert.ok((await transitionTheme(created.theme.themeId, "SCHEDULED", clock)).ok);
  assert.ok((await transitionTheme(created.theme.themeId, "ACTIVE", start)).ok);
  return { theme: created.theme, start };
}

const upload = (h: Harness, w: string, slug: string, file: Buffer, name = "Cyber Panda") => uploadNft(h.deps, { wallet: w, themeSlug: slug, name, description: "desc", file });

// ---- tests -----------------------------------------------------------------------

test("the whole flow: upload -> prepare -> confirm publishes only after the chain checks out", async () => {
  const { theme, start } = await activeTheme();
  clock = start + H;
  const h = makeDeps();
  const w = wallet();

  const up = await upload(h, w, theme.slug, await fresh());
  assert.ok(up.ok);
  if (!up.ok) return;
  assert.equal(up.record.review, "ORIGINAL");
  assert.equal(up.record.status, "UPLOADED");
  assert.ok(h.files.some((f) => f.startsWith("nft/images/")) && h.files.some((f) => f.startsWith("nft/metadata/")));
  assert.ok(!h.files.some((f) => f.includes("original")), "the unsanitized original is never stored");

  const asset = Keypair.generate().publicKey.toBase58();
  const prep = await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: asset });
  assert.ok(prep.ok);
  if (!prep.ok) return;
  assert.equal(prep.expected.royaltyBps, 500);
  assert.equal(prep.expected.owner, w);
  assert.equal((await getRecord(up.record.contentId))?.status, "PREPARED");
  assert.equal((await listPublished(theme.themeId)).length, 0, "prepared is not published");

  const done = await confirmMint(h.deps, { wallet: w, contentId: up.record.contentId, signature: sig() });
  assert.ok(done.ok);
  assert.equal((await getRecord(up.record.contentId))?.status, "PUBLISHED");
  const listed = await listPublished(theme.themeId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].assetAddress, asset);

  const again = await confirmMint(h.deps, { wallet: w, contentId: up.record.contentId, signature: sig() });
  assert.ok(again.ok && again.alreadyPublished, "confirming twice is harmless");
  assert.equal((await listPublished(theme.themeId)).length, 1, "no duplicate listing");
});

test("MINTING INTO A CLOSED THEME IS IMPOSSIBLE: every path refuses once the theme is closing, closed, cancelled or past its end", async () => {
  const { theme, start } = await activeTheme();
  clock = start + H;
  const h = makeDeps();
  const w = wallet();
  const up = await upload(h, w, theme.slug, await fresh());
  assert.ok(up.ok);
  if (!up.ok) return;

  // Time passes the end, the status was never flipped: still refused.
  clock = start + 25 * H;
  const late = await upload(h, wallet(), theme.slug, await fresh());
  assert.ok(!late.ok && late.code === "THEME_CLOSED");
  const latePrep = await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() });
  assert.ok(!latePrep.ok && latePrep.code === "THEME_CLOSED", "an upload made in time can't be prepared after the end");

  // And by status, at a time that's otherwise inside the window.
  const t2 = await activeTheme();
  clock = t2.start + H;
  const upT2 = await upload(h, w, t2.theme.slug, await fresh());
  assert.ok(upT2.ok);
  for (const to of ["CLOSING", "CLOSED"] as const) {
    assert.ok((await transitionTheme(t2.theme.themeId, to, clock)).ok);
    const r = await upload(h, wallet(), t2.theme.slug, await fresh());
    assert.ok(!r.ok && r.code === "THEME_CLOSED", to);
    if (upT2.ok) {
      const p = await prepareMint(h.deps, { wallet: w, contentId: upT2.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() });
      assert.ok(!p.ok && p.code === "THEME_CLOSED", `prepare in ${to}`);
    }
  }
  assert.equal((await listPublished(theme.themeId)).length, 0);
});

test("a mint whose transaction was prepared IN TIME may finish after the theme closes; nothing new can start", async () => {
  const { theme, start } = await activeTheme();
  clock = start + H;
  const h = makeDeps();
  const w = wallet();
  const up = await upload(h, w, theme.slug, await fresh());
  assert.ok(up.ok);
  if (!up.ok) return;
  assert.ok((await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() })).ok);

  assert.ok((await transitionTheme(theme.themeId, "CLOSING", clock)).ok);
  const done = await confirmMint(h.deps, { wallet: w, contentId: up.record.contentId, signature: sig() });
  assert.ok(done.ok, "in-flight mint finishes: " + JSON.stringify(done));
  const newcomer = await upload(h, wallet(), theme.slug, await fresh());
  assert.ok(!newcomer.ok && newcomer.code === "THEME_CLOSED");
});

test("creation limit is per wallet per theme, atomic, and unfinished uploads eventually free their slot", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 2 });
  clock = start + H;
  const h = makeDeps();
  const w = wallet();
  assert.ok((await upload(h, w, theme.slug, await fresh())).ok);
  assert.ok((await upload(h, w, theme.slug, await fresh())).ok);
  const third = await upload(h, w, theme.slug, await fresh());
  assert.ok(!third.ok && third.code === "LIMIT_REACHED");
  // Another wallet is unaffected.
  assert.ok((await upload(h, wallet(), theme.slug, await fresh())).ok);

  // Concurrent slot grabs: only `limit` can win.
  const contenders = await Promise.all(Array.from({ length: 8 }, (_, i) => reserveSlot(theme.themeId, wallet(), `c-${i}-xxxxxxxx`, 1, clock)));
  assert.equal(contenders.filter((r) => r === "ok").length, 8, "different wallets each get their own slot");
  const same = wallet();
  const race = await Promise.all(Array.from({ length: 8 }, (_, i) => reserveSlot(theme.themeId, same, `r-${i}-xxxxxxxx`, 2, clock)));
  assert.equal(race.filter((r) => r === "ok").length, 2, "eight simultaneous requests, exactly two slots");

  // 25 hours later the abandoned uploads expire and free the wallet's slots.
  clock += 25 * H;
  assert.equal(await reserveSlot(theme.themeId, w, "later-xxxxxxxx", 2, clock), "ok");
  clock -= 25 * H;
});

test("exact duplicates are refused (also across wallets and file formats); resuming your own pending upload is allowed", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 5 });
  clock = start + H;
  const h = makeDeps();
  const art = await fresh();
  const a = wallet();
  const first = await upload(h, a, theme.slug, art);
  assert.ok(first.ok);
  if (!first.ok) return;

  const otherWallet = await upload(h, wallet(), theme.slug, art);
  assert.ok(!otherWallet.ok && otherWallet.code === "DUPLICATE");
  const reencoded = await sharp(art).webp({ lossless: true }).toBuffer();
  const asWebp = await upload(h, wallet(), theme.slug, reencoded);
  assert.ok(!asWebp.ok && asWebp.code === "DUPLICATE", "same pixels in another format is still a duplicate");

  const resumed = await upload(h, a, theme.slug, art);
  assert.ok(resumed.ok && resumed.resumed && resumed.record.contentId === first.record.contentId);
});

test("a near-duplicate needs an admin's approval before it can be minted; rejecting frees the slot and the image", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 1 });
  clock = start + H;
  const h = makeDeps();
  const original = await fresh();
  const first = await upload(h, wallet(), theme.slug, original);
  assert.ok(first.ok);

  const copier = wallet();
  const copy = await sharp(original).resize(420).jpeg({ quality: 55 }).toBuffer();
  const flagged = await upload(h, copier, theme.slug, copy);
  assert.ok(flagged.ok);
  if (!flagged.ok) return;
  assert.equal(flagged.record.review, "REVIEW_REQUIRED");
  assert.ok(flagged.record.nearOf && flagged.record.nearOf.distance <= 8);

  const asset = Keypair.generate().publicKey.toBase58();
  const blocked = await prepareMint(h.deps, { wallet: copier, contentId: flagged.record.contentId, assetAddress: asset });
  assert.ok(!blocked.ok && blocked.code === "REVIEW_PENDING");

  assert.ok((await reviewNft({ contentId: flagged.record.contentId, decision: "approve" })).ok);
  assert.ok((await prepareMint(h.deps, { wallet: copier, contentId: flagged.record.contentId, assetAddress: asset })).ok);
  assert.equal((await reviewNft({ contentId: flagged.record.contentId, decision: "reject" })).ok, false, "already decided");

  // A second flagged upload, this time rejected.
  const other = wallet();
  const copy2 = await sharp(original).resize(380).jpeg({ quality: 45 }).toBuffer();
  const flagged2 = await upload(h, other, theme.slug, copy2);
  assert.ok(flagged2.ok && flagged2.record.review === "REVIEW_REQUIRED");
  if (!flagged2.ok) return;
  const rej = await reviewNft({ contentId: flagged2.record.contentId, decision: "reject" });
  assert.ok(rej.ok && rej.record.status === "REJECTED");
  const p = await prepareMint(h.deps, { wallet: other, contentId: flagged2.record.contentId, assetAddress: asset });
  assert.ok(!p.ok);
  assert.equal(await reserveSlot(theme.themeId, other, "again-xxxxxxxx", 1, clock), "ok", "the rejected upload gave its slot back");
});

test("only the wallet that uploaded can prepare or confirm", async () => {
  const { theme, start } = await activeTheme();
  clock = start + H;
  const h = makeDeps();
  const owner = wallet();
  const up = await upload(h, owner, theme.slug, await fresh());
  assert.ok(up.ok);
  if (!up.ok) return;
  const thief = wallet();
  const asset = Keypair.generate().publicKey.toBase58();
  const p = await prepareMint(h.deps, { wallet: thief, contentId: up.record.contentId, assetAddress: asset });
  assert.ok(!p.ok && p.code === "NOT_FOUND");
  assert.ok((await prepareMint(h.deps, { wallet: owner, contentId: up.record.contentId, assetAddress: asset })).ok);
  const c = await confirmMint(h.deps, { wallet: thief, contentId: up.record.contentId, signature: sig() });
  assert.ok(!c.ok && c.code === "NOT_FOUND");
  assert.equal((await confirmMint(h.deps, { wallet: owner, contentId: "does-not-exist-1", signature: sig() })).ok, false);
});

test("confirm never publishes on a failed transaction, a pending one, or an asset that doesn't match — and says why", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 10 });
  clock = start + H;
  const w = wallet();
  const mk = async (h: Harness, art: Buffer) => {
    const up = await upload(h, w, theme.slug, art);
    assert.ok(up.ok);
    if (!up.ok) throw new Error();
    assert.ok((await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: Keypair.generate().publicKey.toBase58() })).ok);
    return up.record.contentId;
  };

  const failed = makeDeps();
  failed.state.txStatus = "failed";
  const id1 = await mk(failed, await fresh());
  const r1 = await confirmMint(failed.deps, { wallet: w, contentId: id1, signature: sig() });
  assert.ok(!r1.ok && r1.code === "TX_FAILED");
  assert.equal((await getRecord(id1))?.status, "PREPARED", "can be retried");

  const pending = makeDeps();
  pending.state.txStatus = "pending";
  const id2 = await mk(pending, await fresh());
  const r2 = await confirmMint(pending.deps, { wallet: w, contentId: id2, signature: sig() });
  assert.ok(!r2.ok && r2.code === "PENDING" && r2.status === 202);

  const notVisible = makeDeps();
  notVisible.state.chainProblem = "asset not found on-chain";
  const id3 = await mk(notVisible, await fresh());
  const r3 = await confirmMint(notVisible.deps, { wallet: w, contentId: id3, signature: sig() });
  assert.ok(!r3.ok && r3.code === "PENDING", "confirmed but not visible yet is not an error");

  const tampered = makeDeps();
  tampered.state.chainProblem = "unexpected plugin: permanentTransferDelegate";
  const id4 = await mk(tampered, await fresh());
  const r4 = await confirmMint(tampered.deps, { wallet: w, contentId: id4, signature: sig() });
  assert.ok(!r4.ok && r4.code === "MISMATCH");
  assert.equal((await getRecord(id4))?.status, "REJECTED_ONCHAIN");
  assert.ok(tampered.alerts.length === 1, "raises an alert");
  const bad = await confirmMint(tampered.deps, { wallet: w, contentId: id4, signature: sig() });
  assert.ok(!bad.ok, "a rejected asset can't be published later");

  const listed = (await listPublished(theme.themeId)).map((i) => i.contentId);
  for (const id of [id1, id2, id3, id4]) assert.ok(!listed.includes(id));

  const badSig = makeDeps();
  const id5 = await mk(badSig, await fresh());
  for (const s of ["", "short", 5, null, "!".repeat(88)]) {
    const r = await confirmMint(badSig.deps, { wallet: w, contentId: id5, signature: s });
    assert.ok(!r.ok && r.code === "BAD_SIGNATURE", String(s));
  }
});

test("re-preparing: the same asset key can be retried; a DIFFERENT key only after the first transaction has surely expired", async () => {
  const { theme, start } = await activeTheme();
  clock = start + H;
  const h = makeDeps();
  const w = wallet();
  const up = await upload(h, w, theme.slug, await fresh());
  assert.ok(up.ok);
  if (!up.ok) return;
  const a1 = Keypair.generate().publicKey.toBase58();
  const a2 = Keypair.generate().publicKey.toBase58();
  assert.ok((await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: a1 })).ok);
  assert.ok((await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: a1 })).ok, "same key: fine");
  const early = await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: a2 });
  assert.ok(!early.ok && early.code === "PREPARED_ELSEWHERE", "the first transaction might still land");
  clock += REPREPARE_AFTER_MS + 1;
  assert.ok((await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: a2 })).ok);
  clock -= REPREPARE_AFTER_MS + 1;
});

test("bad inputs are refused with clear codes: text, image, asset address", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 10 });
  clock = start + H;
  const h = makeDeps();
  const w = wallet();
  const art = await fresh();
  const noName = await uploadNft(h.deps, { wallet: w, themeSlug: theme.slug, name: "", description: "d", file: art });
  assert.ok(!noName.ok && noName.code === "BAD_TEXT");
  const notImage = await upload(h, w, theme.slug, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
  assert.ok(!notImage.ok && notImage.code === "BAD_IMAGE");
  const unknownTheme = await upload(h, w, "no-such-theme", art);
  assert.ok(!unknownTheme.ok && unknownTheme.code === "THEME_CLOSED");

  const up = await upload(h, w, theme.slug, art);
  assert.ok(up.ok);
  if (!up.ok) return;
  for (const asset of ["", "not-a-key", 5, null, w]) {
    const r = await prepareMint(h.deps, { wallet: w, contentId: up.record.contentId, assetAddress: asset });
    assert.ok(!r.ok && r.code === "BAD_ASSET", String(asset));
  }
  assert.equal(h.state.builds, 0, "no transaction is built for a bad request");
});

test("when file storage fails, the slot and the image reservation are given back", async () => {
  const { theme, start } = await activeTheme({ creationLimit: 1 });
  clock = start + H;
  const broken = makeDeps({
    putFile: async () => {
      throw new Error("blob down");
    },
  });
  const w = wallet();
  const art = await fresh();
  const r = await upload(broken, w, theme.slug, art);
  assert.ok(!r.ok && r.code === "STORAGE");
  assert.equal(broken.alerts.length, 1);
  const ok = makeDeps();
  assert.ok((await upload(ok, w, theme.slug, art)).ok, "the same wallet can retry the same image: nothing was left reserved");
});
