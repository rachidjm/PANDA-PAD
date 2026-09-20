import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_FRESH_MS, checkAdmin, parseAdminWallets } from "./admin-policy";

const admins = parseAdminWallets(" A , B,, ");

test("parses a comma list, ignoring blanks", () => {
  assert.deepEqual([...admins].sort(), ["A", "B"]);
  assert.equal(parseAdminWallets(undefined).size, 0);
  assert.equal(parseAdminWallets("").size, 0);
});

test("only a fresh session of a listed wallet is admin", () => {
  const now = 10_000_000;
  assert.equal(checkAdmin({ wallet: "A", issuedAt: now - 1000 }, admins, now), "ok");
  assert.equal(checkAdmin({ wallet: "A", issuedAt: now - ADMIN_FRESH_MS }, admins, now), "ok");
  assert.equal(checkAdmin({ wallet: "A", issuedAt: now - ADMIN_FRESH_MS - 1 }, admins, now), "stale_session");
  assert.equal(checkAdmin({ wallet: "C", issuedAt: now }, admins, now), "not_admin");
  assert.equal(checkAdmin(null, admins, now), "unauthenticated");
});

test("no configured admins means nobody is admin (fail closed)", () => {
  assert.equal(checkAdmin({ wallet: "A", issuedAt: 1 }, new Set(), 1), "not_admin");
});

test("a session issued in the future is rejected", () => {
  assert.equal(checkAdmin({ wallet: "A", issuedAt: 1_000_000_000 }, admins, 1000), "stale_session");
});
