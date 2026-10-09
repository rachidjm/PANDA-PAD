import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { tgGetLinkCode, tgGetUser, tgWalletHolder } from "@/lib/db/telegram";
import { buildLinkMessage, completeLink, createLinkCode, hashLinkCode, LINK_TTL_MS, linkMessageFor } from "./link";
import { newUserId } from "./testing";

let db: Db;
before(async () => {
  db = await newTestDb();
});

const DOMAIN = "launchonpanda.app";

/** ed25519 signature of `message` by `kp`, base58 — what a wallet's signMessage returns. */
function signWith(kp: Keypair, message: string): string {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" });
  return bs58.encode(sign(null, Buffer.from(message), key));
}

async function setup(now = 2_000_000_000_000) {
  const tg = newUserId();
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const { code } = await createLinkCode(db, tg, now);
  const m = await linkMessageFor(db, { code, wallet, replace: false, domain: DOMAIN, now });
  assert.equal(m.ok, true);
  if (!m.ok) throw new Error();
  return { tg, kp, wallet, code, now, message: m.message };
}

test("the message names the domain, wallet, Telegram id, code, replace flag, issue and expiry dates", async () => {
  const s = await setup();
  for (const part of [`Domain: ${DOMAIN}`, `Wallet: ${s.wallet}`, `Telegram ID: ${s.tg}`, `Code: ${s.code}`, "Replace the Telegram account currently linked to this wallet: no", "Issued At: ", "Expires At: "]) assert.ok(s.message.includes(part), part);
  assert.match(s.message, /never ask for your seed phrase or private key/);
  const rec = await tgGetLinkCode(db, hashLinkCode(s.code));
  assert.ok(rec && rec.expiresAt - rec.createdAt === LINK_TTL_MS);
  assert.equal(JSON.stringify(rec).includes(s.code), false, "only the hash of the code is stored");
});

test("happy path: links the wallet to the Telegram account that asked for the code", async () => {
  const s = await setup();
  const r = await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(s.kp, s.message), replace: false, domain: DOMAIN, now: s.now + 1000 });
  assert.deepEqual(r, { ok: true, telegramId: s.tg, wallet: s.wallet, previousTelegramId: null });
  assert.equal((await tgGetUser(db, s.tg))?.wallet, s.wallet);
});

test("a used code, or the same signature replayed, fails — the same link can't happen twice", async () => {
  const s = await setup();
  const signature = signWith(s.kp, s.message);
  assert.equal((await completeLink(db, { code: s.code, wallet: s.wallet, signature, replace: false, domain: DOMAIN, now: s.now })).ok, true);
  const again = await completeLink(db, { code: s.code, wallet: s.wallet, signature, replace: false, domain: DOMAIN, now: s.now + 5 });
  assert.deepEqual(again, { ok: false, error: "code_used_or_expired" });
});

test("an expired code fails, even with a perfect signature", async () => {
  const s = await setup();
  const r = await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(s.kp, s.message), replace: false, domain: DOMAIN, now: s.now + LINK_TTL_MS });
  assert.deepEqual(r, { ok: false, error: "code_used_or_expired" });
});

test("a signature by ANOTHER wallet fails", async () => {
  const s = await setup();
  const r = await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(Keypair.generate(), s.message), replace: false, domain: DOMAIN, now: s.now });
  assert.deepEqual(r, { ok: false, error: "bad_signature" });
});

test("a signed message for ANOTHER Telegram id, ANOTHER domain or ANOTHER code fails — the server checks its own message", async () => {
  const s = await setup();
  const rec = (await tgGetLinkCode(db, hashLinkCode(s.code)))!;
  const variants = [
    buildLinkMessage({ domain: DOMAIN, wallet: s.wallet, telegramId: s.tg + 1, code: s.code, replace: false, issuedAt: rec.createdAt, expiresAt: rec.expiresAt }),
    buildLinkMessage({ domain: "evil.example", wallet: s.wallet, telegramId: s.tg, code: s.code, replace: false, issuedAt: rec.createdAt, expiresAt: rec.expiresAt }),
    buildLinkMessage({ domain: DOMAIN, wallet: s.wallet, telegramId: s.tg, code: "A".repeat(24), replace: false, issuedAt: rec.createdAt, expiresAt: rec.expiresAt }),
  ];
  for (const msg of variants) {
    const r = await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(s.kp, msg), replace: false, domain: DOMAIN, now: s.now });
    assert.deepEqual(r, { ok: false, error: "bad_signature" });
  }
  // And the code is still usable by its rightful owner: a failed attempt doesn't burn it.
  assert.equal((await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(s.kp, s.message), replace: false, domain: DOMAIN, now: s.now })).ok, true);
});

test("a code can't link a DIFFERENT Telegram account: it is bound to the one that asked for it", async () => {
  const s = await setup();
  const other = newUserId();
  const forged = buildLinkMessage({ domain: DOMAIN, wallet: s.wallet, telegramId: other, code: s.code, replace: false, issuedAt: s.now, expiresAt: s.now + LINK_TTL_MS });
  const r = await completeLink(db, { code: s.code, wallet: s.wallet, signature: signWith(s.kp, forged), replace: false, domain: DOMAIN, now: s.now });
  assert.equal(r.ok, false);
  assert.equal(await tgGetUser(db, other), null);
});

test("a wallet already linked to another Telegram account: refused (code kept) until the user signs 'replace: yes'; then the old account loses it", async () => {
  const a = await setup();
  assert.equal((await completeLink(db, { code: a.code, wallet: a.wallet, signature: signWith(a.kp, a.message), replace: false, domain: DOMAIN, now: a.now })).ok, true);
  // Another Telegram account asks to link the SAME wallet (its owner signs).
  const tgB = newUserId();
  const { code } = await createLinkCode(db, tgB, a.now);
  const msgNo = (await linkMessageFor(db, { code, wallet: a.wallet, replace: false, domain: DOMAIN, now: a.now })) as { ok: true; message: string };
  const refused = await completeLink(db, { code, wallet: a.wallet, signature: signWith(a.kp, msgNo.message), replace: false, domain: DOMAIN, now: a.now });
  assert.deepEqual(refused, { ok: false, error: "linked_elsewhere" });
  assert.equal(await tgWalletHolder(db, a.wallet), a.tg, "nothing changed silently");
  // The "no" signature can't be reused to replace: the replace flag is part of what's signed.
  const sneaky = await completeLink(db, { code, wallet: a.wallet, signature: signWith(a.kp, msgNo.message), replace: true, domain: DOMAIN, now: a.now });
  assert.deepEqual(sneaky, { ok: false, error: "bad_signature" });
  const msgYes = (await linkMessageFor(db, { code, wallet: a.wallet, replace: true, domain: DOMAIN, now: a.now })) as { ok: true; message: string };
  const replaced = await completeLink(db, { code, wallet: a.wallet, signature: signWith(a.kp, msgYes.message), replace: true, domain: DOMAIN, now: a.now });
  assert.deepEqual(replaced, { ok: true, telegramId: tgB, wallet: a.wallet, previousTelegramId: a.tg });
  assert.equal(await tgWalletHolder(db, a.wallet), tgB);
  assert.equal((await tgGetUser(db, a.tg))?.wallet, null);
});

test("garbage in (no code, bad wallet, bad signature encoding) is refused before anything is read", async () => {
  const s = await setup();
  for (const bad of [
    { code: "short", wallet: s.wallet, signature: "x" },
    { code: s.code, wallet: "not-a-wallet", signature: "x" },
    { code: s.code, wallet: s.wallet, signature: "0OIl" },
    { code: s.code, wallet: s.wallet, signature: 42 },
  ]) {
    assert.deepEqual(await completeLink(db, { ...bad, replace: false, domain: DOMAIN, now: s.now }), { ok: false, error: "invalid" });
  }
});
