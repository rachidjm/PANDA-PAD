import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/lib/db/client";
import { setDbForTests } from "@/lib/db/client";
import { newTestDb } from "@/lib/db/testing";
import { pgRecordReferralPayout } from "@/lib/db/referrals";
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

const addr = () => Keypair.generate().publicKey.toBase58();
const req = (qs: string) => new Request(`http://x/api/referrals/payouts?${qs}`);

test("404 with the feature off", async () => {
  process.env.FEATURE_REFERRALS = "false";
  const res = await GET(req(`wallet=${addr()}`));
  assert.equal(res.status, 404);
});

test("400 without a valid wallet", async () => {
  const res = await GET(req("wallet=not-an-address"));
  assert.equal(res.status, 400);
});

test("lists this referrer's payouts, newest first, with a total for pagination", async () => {
  const referrer = addr();
  const invitee = addr();
  await pgRecordReferralPayout(db, { signature: "SIG1", referrer, referred: invitee, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 100, ts: 1000 });
  await pgRecordReferralPayout(db, { signature: "SIG2", referrer, referred: invitee, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 200, ts: 2000 });
  const res = await GET(req(`wallet=${referrer}`));
  const body = (await res.json()) as { payouts: { lamports: number }[]; total: number };
  assert.equal(body.total, 2);
  assert.deepEqual(body.payouts.map((p) => p.lamports), [200, 100]);
});

test("q filters by a substring of the invitee's wallet", async () => {
  const referrer = addr();
  const a = addr();
  const b = addr();
  await pgRecordReferralPayout(db, { signature: "SIG1", referrer, referred: a, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 100, ts: 1000 });
  await pgRecordReferralPayout(db, { signature: "SIG2", referrer, referred: b, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 200, ts: 2000 });
  const res = await GET(req(`wallet=${referrer}&q=${a}`));
  const body = (await res.json()) as { total: number };
  assert.equal(body.total, 1);
});

test("period=today excludes a payout from yesterday", async () => {
  const referrer = addr();
  const invitee = addr();
  const DAY = 86_400_000;
  await pgRecordReferralPayout(db, { signature: "SIGOLD", referrer, referred: invitee, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 100, ts: Date.now() - 2 * DAY });
  await pgRecordReferralPayout(db, { signature: "SIGNEW", referrer, referred: invitee, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 200, ts: Date.now() });
  const res = await GET(req(`wallet=${referrer}&period=today`));
  const body = (await res.json()) as { total: number };
  assert.equal(body.total, 1);
});

test("format=csv returns a CSV download with a header row and one line per payout", async () => {
  const referrer = addr();
  const invitee = addr();
  await pgRecordReferralPayout(db, { signature: "SIG1", referrer, referred: invitee, mint: "MINTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", lamports: 500_000_000, ts: 1000 });
  const res = await GET(req(`wallet=${referrer}&format=csv`));
  assert.equal(res.headers.get("Content-Type"), "text/csv; charset=utf-8");
  assert.ok(res.headers.get("Content-Disposition")?.includes("attachment"));
  const text = await res.text();
  const lines = text.trim().split("\n");
  assert.equal(lines[0], "signature,invitee_wallet,mint,sol,date_utc");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith("SIG1,"));
  assert.ok(lines[1].includes("0.5,"), "500,000,000 lamports is 0.5 SOL");
});

test("an empty result is still a well-formed CSV (header only)", async () => {
  const res = await GET(req(`wallet=${addr()}&format=csv`));
  const text = await res.text();
  assert.equal(text.trim(), "signature,invitee_wallet,mint,sol,date_utc");
});
