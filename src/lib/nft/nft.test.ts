import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { hammingDistance, IMAGE_LIMITS, ImageRejected, processImage, sniffImageKind } from "./image";
import { classify, DedupeEntry, DedupeIndex, EMPTY_INDEX, markPublished, NEAR_THRESHOLD, PENDING_TTL_MS, release, reserve } from "./dedupe";
import { buildMetadata, cleanText, LIMITS, validateTexts } from "./metadata";

// ---- test artwork (SVG is used only to DRAW the fixtures; uploads of SVG are refused) ---------------------------

const S = 600;
const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="100%" height="100%" fill="#204060"/>${body}</svg>`);
const ART_STRIPES = svg(Array.from({ length: 12 }, (_, i) => `<rect x="${i * 50}" y="0" width="${20 + (i % 4) * 8}" height="${S}" fill="#f0c040"/>`).join(""));
const ART_CIRCLES = svg(Array.from({ length: 8 }, (_, i) => `<circle cx="${80 + i * 60}" cy="${80 + ((i * 97) % 440)}" r="${30 + (i % 3) * 25}" fill="#e05050"/>`).join(""));
const ART_BLOCKS = svg(`<rect x="40" y="380" width="300" height="180" fill="#40e0a0"/><rect x="380" y="40" width="160" height="500" fill="#a060e0"/><rect x="40" y="40" width="300" height="60" fill="#fff"/>`);

const png = (svgBuf: Buffer) => sharp(svgBuf).png().toBuffer();

test("file type comes from the real leading bytes", async () => {
  assert.equal(sniffImageKind(await png(ART_STRIPES)), "png");
  assert.equal(sniffImageKind(await sharp(ART_STRIPES).jpeg().toBuffer()), "jpeg");
  assert.equal(sniffImageKind(await sharp(ART_STRIPES).webp().toBuffer()), "webp");
  assert.equal(sniffImageKind(await sharp(ART_STRIPES).gif().toBuffer()), "gif");
  for (const not of [ART_STRIPES, Buffer.from("<html><script>alert(1)</script></html>"), Buffer.from("GIF"), Buffer.alloc(0), Buffer.from([0x89, 0x50]), Buffer.from("MZ\x90\x00")]) {
    assert.equal(sniffImageKind(not), null);
  }
});

test("rejects: empty, oversize, SVG, HTML, unknown types, corrupt bodies, tiny and absurd dimensions", async () => {
  const rejected = async (b: Buffer, code: string) => {
    await assert.rejects(processImage(b), (e: unknown) => e instanceof ImageRejected && e.code === code, code);
  };
  await rejected(Buffer.alloc(0), "EMPTY");
  await rejected(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(IMAGE_LIMITS.maxBytes)]), "TOO_LARGE");
  await rejected(ART_STRIPES, "UNSUPPORTED_TYPE"); // SVG
  await rejected(Buffer.from("<html><body>not an image</body></html>"), "UNSUPPORTED_TYPE");
  await rejected(Buffer.from("MZ\x90\x00 this is an executable"), "UNSUPPORTED_TYPE");
  await rejected(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("garbage that is not a png body")]), "CORRUPT");
  const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#123456" } }).png().toBuffer();
  await rejected(tiny, "BAD_DIMENSIONS");
});

test("a decompression bomb (an enormous image that compresses to almost nothing) is refused before it is decoded", async () => {
  // A PNG whose header claims 60,000 x 60,000 pixels (3.6 billion) with a tiny body.
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(60_000, 16);
  header.writeUInt32BE(60_000, 20);
  header[24] = 8;
  header[25] = 2;
  const t0 = Date.now();
  await assert.rejects(processImage(header), ImageRejected);
  assert.ok(Date.now() - t0 < 3000, "refused quickly, not after a huge allocation");
});

test("EXIF/GPS metadata and payloads appended to the file do not survive", async () => {
  const withExif = await sharp(ART_STRIPES)
    .jpeg()
    .withExif({ IFD0: { Copyright: "SECRET-COPYRIGHT-TAG" }, IFD3: { GPSLatitudeRef: "N" } })
    .toBuffer();
  assert.ok(withExif.includes(Buffer.from("SECRET-COPYRIGHT-TAG")), "fixture really carries metadata");
  const out = await processImage(withExif);
  assert.ok(!out.bytes.includes(Buffer.from("SECRET-COPYRIGHT-TAG")));
  assert.equal((await sharp(out.bytes).metadata()).exif, undefined);

  const polyglot = Buffer.concat([await png(ART_STRIPES), Buffer.from("<script>alert('pwned')</script>")]);
  const clean = await processImage(polyglot);
  assert.ok(!clean.bytes.includes(Buffer.from("<script>")), "appended payload is gone");
});

test("output is bounded to 2048 px and the format is one of PNG/JPEG", async () => {
  const big = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: "#336699" } }).png().toBuffer();
  const out = await processImage(big);
  assert.ok(out.width <= 2048 && out.height <= 2048);
  assert.equal(out.width, 2048);
  assert.equal(out.height, 1536);
  assert.ok(["image/png", "image/jpeg"].includes(out.mime));
  assert.equal((await processImage(await sharp(ART_STRIPES).webp().toBuffer())).mime, "image/png");
});

test("the same artwork gives the same pixel hash whatever the file format or metadata (exact-duplicate detection)", async () => {
  const a = await processImage(await png(ART_CIRCLES));
  const asWebpLossless = await processImage(await sharp(ART_CIRCLES).webp({ lossless: true }).toBuffer());
  const asPngWithExif = await processImage(await sharp(ART_CIRCLES).png().withExif({ IFD0: { Copyright: "x" } }).toBuffer());
  assert.equal(a.pixelHash, asWebpLossless.pixelHash);
  assert.equal(a.pixelHash, asPngWithExif.pixelHash);
  assert.notEqual(a.originalSha256, asWebpLossless.originalSha256, "the raw files differ — that's why the pixel hash exists");
  assert.notEqual(a.pixelHash, (await processImage(await png(ART_STRIPES))).pixelHash);
  assert.match(a.pixelHash, /^[0-9a-f]{64}$/);
  assert.match(a.dhash, /^[0-9a-f]{16}$/);
});

test("a resized and re-compressed copy is 'near' (within the threshold); different artwork is far", async () => {
  const original = await processImage(await png(ART_STRIPES));
  const copy = await processImage(await sharp(ART_STRIPES).resize(420).jpeg({ quality: 55 }).toBuffer());
  assert.notEqual(copy.pixelHash, original.pixelHash, "not pixel-identical, so not an 'exact' duplicate");
  assert.ok(hammingDistance(original.dhash, copy.dhash) <= NEAR_THRESHOLD, `copy distance ${hammingDistance(original.dhash, copy.dhash)}`);
  for (const other of [ART_CIRCLES, ART_BLOCKS]) {
    const d = hammingDistance(original.dhash, (await processImage(await png(other))).dhash);
    assert.ok(d > NEAR_THRESHOLD, `different artwork distance ${d}`);
  }
});

test("hamming distance", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hammingDistance("0000000000000001", "0000000000000003"), 1);
  for (const bad of ["", "xyz", "0".repeat(15), "0".repeat(17), "G".repeat(16)]) assert.throws(() => hammingDistance(bad, "0".repeat(16)));
});

// ---- dedupe ----------------------------------------------------------------

const now = 1_000_000;
const entry = (over: Partial<DedupeEntry> = {}): DedupeEntry => ({
  contentId: "c1",
  pixelHash: "a".repeat(64),
  dhash: "0000000000000000",
  wallet: "W1",
  themeId: 1,
  status: "published",
  createdAt: now - 10,
  ...over,
});
const idx = (...entries: DedupeEntry[]): DedupeIndex => ({ ...EMPTY_INDEX, entries });
const h = (over: Partial<{ pixelHash: string; dhash: string }> = {}) => ({ pixelHash: "b".repeat(64), dhash: "ffffffffffffffff", ...over });

test("dedupe verdicts: unique, exact, near, own pending upload", () => {
  assert.equal(classify(EMPTY_INDEX, h(), "W2", now).kind, "unique");
  assert.equal(classify(idx(entry()), h(), "W2", now).kind, "unique");
  assert.equal(classify(idx(entry()), h({ pixelHash: "a".repeat(64) }), "W2", now).kind, "exact");
  assert.equal(classify(idx(entry()), h({ pixelHash: "a".repeat(64) }), "W1", now).kind, "exact", "own PUBLISHED copy is still a duplicate");
  const near = classify(idx(entry()), h({ dhash: "000000000000000f" }), "W2", now);
  assert.equal(near.kind, "near");
  assert.equal(near.kind === "near" && near.distance, 4);
  assert.equal(classify(idx(entry()), h({ dhash: "0000000000001ff0" }), "W2", now).kind, "unique", "9 bits apart is outside the threshold");
  const pending = entry({ status: "pending", expiresAt: now + 1000 });
  assert.equal(classify(idx(pending), h({ pixelHash: "a".repeat(64) }), "W1", now).kind, "own_pending");
  assert.equal(classify(idx(pending), h({ pixelHash: "a".repeat(64) }), "W2", now).kind, "exact", "someone else's pending upload blocks a copy");
});

test("a pending upload that expired stops reserving its image; a published one never does", () => {
  const stale = entry({ status: "pending", expiresAt: now - 1 });
  assert.equal(classify(idx(stale), h({ pixelHash: "a".repeat(64) }), "W2", now).kind, "unique");
  assert.equal(classify(idx(stale), h({ dhash: "0000000000000000" }), "W2", now).kind, "unique", "nor a near match");
  assert.equal(classify(idx(entry()), h({ pixelHash: "a".repeat(64) }), "W2", now + 365 * 24 * 3_600_000).kind, "exact");
});

test("the nearest match is reported when several are within range", () => {
  const i = idx(entry({ contentId: "far", dhash: "000000000000007f" }), entry({ contentId: "close", pixelHash: "c".repeat(64), dhash: "0000000000000003" }));
  const v = classify(i, h({ dhash: "0000000000000000" }), "W9", now);
  assert.ok(v.kind === "near" && v.of.contentId === "close" && v.distance === 2);
});

test("reserve / publish / release never mutate their input and prune expired reservations", () => {
  const stale = entry({ contentId: "old", status: "pending", expiresAt: now - 5 });
  const start = idx(stale, entry({ contentId: "keep" }));
  const snapshot = JSON.stringify(start);
  const added = reserve(start, entry({ contentId: "new", status: "pending", expiresAt: now + PENDING_TTL_MS }), now);
  assert.equal(JSON.stringify(start), snapshot);
  assert.deepEqual(added.entries.map((e) => e.contentId), ["keep", "new"]);
  const published = markPublished(added, "new");
  assert.equal(published.entries.find((e) => e.contentId === "new")?.status, "published");
  assert.equal(published.entries.find((e) => e.contentId === "new")?.expiresAt, undefined);
  assert.deepEqual(release(published, "new").entries.map((e) => e.contentId), ["keep"]);
});

// ---- metadata ---------------------------------------------------------------

test("text is cleaned: control characters and angle brackets removed, whitespace collapsed", () => {
  assert.equal(cleanText("  Hello\u0000  <b>World</b>\n\tagain "), "Hello bWorld/b again");
  assert.equal(cleanText("<script>alert(1)</script>"), "scriptalert(1)/script");
  assert.equal(cleanText("‮"), "‮", "bidi controls are not silently trusted or removed here (display escapes them)");
});

test("name/description validation and limits", () => {
  const ok = validateTexts({ name: " Cyber Panda #1 ", description: "A panda.\n" });
  assert.deepEqual(ok, { ok: true, name: "Cyber Panda #1", description: "A panda." });
  for (const bad of [{ name: "x", description: "" }, { name: "n".repeat(LIMITS.name + 1), description: "" }, { name: 5, description: "d" }, { name: "ok name", description: 5 }, { name: "<>", description: "" }, { name: "ok name", description: "d".repeat(LIMITS.description + 1) }]) {
    assert.equal(validateTexts(bad as never).ok, false, JSON.stringify(bad).slice(0, 50));
  }
  assert.equal(validateTexts({ name: "ok name", description: "" }).ok, true, "an empty description is allowed");
});

test("metadata JSON is deterministic, points at the image, and carries the provenance attributes", () => {
  const args = {
    name: "Cyber Panda",
    description: "d",
    imageUrl: "https://blob.example/nft/images/abc.png",
    imageMime: "image/png",
    siteUrl: "https://panda.example/",
    creator: "Creator111",
    theme: { slug: "cyberpanda", title: "CyberPanda", themeId: 1 },
    contentHash: "f".repeat(64),
  };
  const a = buildMetadata(args);
  assert.equal(JSON.stringify(a), JSON.stringify(buildMetadata(args)));
  assert.equal(a.image, args.imageUrl);
  assert.equal(a.external_url, "https://panda.example/themes/cyberpanda");
  assert.deepEqual(a.attributes.map((x) => x.trait_type), ["Theme", "Theme ID", "Content Hash"]);
  assert.deepEqual(a.properties.creators, [{ address: "Creator111", share: 100 }]);
  assert.ok(!JSON.stringify(a).match(/b(session|cookie|email|ip)b/i));
});
