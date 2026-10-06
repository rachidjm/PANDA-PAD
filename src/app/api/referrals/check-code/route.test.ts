import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgSetRecruiterCode } from "@/lib/db/fee-tier";
import { GET } from "./route";

let db: Db;
const SAVED = { ...process.env };
before(async () => {
  db = await newTestDb();
  setDbForTests(db);
});
after(() => {
  setDbForTests(null);
  process.env = SAVED;
});
beforeEach(() => {
  process.env.FEATURE_REFERRALS = "true";
});

const check = (code: string | null) => GET(new Request(`https://panda.test/api/referrals/check-code${code === null ? "" : `?code=${encodeURIComponent(code)}`}`));

test("check-code: a real recruiter code answers valid: true", async () => {
  await pgSetRecruiterCode(db, Keypair.generate().publicKey.toBase58(), "checkme1", Date.now());
  const res = await check("checkme1");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { valid: true });
});

test("check-code: the match ignores case and surrounding spaces, like the verify path does", async () => {
  await pgSetRecruiterCode(db, Keypair.generate().publicKey.toBase58(), "checkme2", Date.now());
  assert.equal(((await (await check("  CHECKME2 ")).json()) as { valid: boolean }).valid, true);
});

test("check-code: an unknown code answers valid: false (the modal shows 'Este código no existe')", async () => {
  assert.deepEqual(await (await check("nosuchcode")).json(), { valid: false });
});

test("check-code: no code, or only spaces, is valid: false without touching the database", async () => {
  assert.deepEqual(await (await check(null)).json(), { valid: false });
  assert.deepEqual(await (await check("   ")).json(), { valid: false });
});

test("check-code: with the Recruiters program off it's a plain 404", async () => {
  process.env.FEATURE_REFERRALS = "false";
  assert.equal((await check("checkme1")).status, 404);
});
