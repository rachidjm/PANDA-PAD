import { test } from "node:test";
import assert from "node:assert/strict";
import { accessFromStatus, confirmRoute, needsSignIn, pandaAccessFor, type PandaAccess } from "./access-state";

const held = {}; // a sell / stop drawn on a coin already held: no buy
const withBuy = { buy: 0.001 };

test("no session: sign in, with a button — and the sell / stop is never sent to Jupiter", () => {
  const a = pandaAccessFor({ featureOn: true, source: "pump-fun", server: accessFromStatus(401, false) });
  assert.equal(a, "signin");
  assert.equal(needsSignIn(a), true);
  assert.equal(confirmRoute(held, a), "blocked");
});

test("session expired after it worked on this page: says so and asks to sign in again, never switches to Jupiter", () => {
  const a = pandaAccessFor({ featureOn: true, source: "pump-fun", server: accessFromStatus(401, true) });
  assert.equal(a, "expired");
  assert.equal(needsSignIn(a), true);
  assert.equal(confirmRoute(held, a), "blocked");
});

test("wallet not on the allowlist (403): coming soon, never Jupiter", () => {
  const a = pandaAccessFor({ featureOn: true, source: "pump-fun", server: accessFromStatus(403, false) });
  assert.equal(a, "not_allowed");
  assert.equal(confirmRoute(held, a), "blocked");
});

test("feature off (flag or 404): coming soon, never Jupiter", () => {
  assert.equal(pandaAccessFor({ featureOn: false, source: "pump-fun", server: "checking" }), "not_allowed");
  assert.equal(accessFromStatus(404, false), "not_allowed");
  assert.equal(confirmRoute(held, "not_allowed"), "blocked");
});

test("a coin that isn't Pump.fun / PumpSwap: unsupported, never Jupiter — whatever the server says", () => {
  for (const source of ["other", undefined, "raydium"]) {
    const a = pandaAccessFor({ featureOn: true, source, server: "ok" });
    assert.equal(a, "unsupported");
    assert.equal(confirmRoute(held, a), "blocked");
  }
});

test("server or network error: can't load, never Jupiter", () => {
  for (const s of [500, 502, 429, "network"] as const) {
    const a = pandaAccessFor({ featureOn: true, source: "pumpswap", server: accessFromStatus(s, true) });
    assert.equal(a, "error");
    assert.equal(confirmRoute(held, a), "blocked");
  }
});

test("still checking: nothing is sent until the answer is in", () => {
  assert.equal(confirmRoute(held, "checking"), "blocked");
});

test("no case at all routes a sell / stop alone to Jupiter; only a drawn buy goes to Jupiter", () => {
  const all: PandaAccess[] = ["ok", "checking", "signin", "expired", "not_allowed", "unsupported", "error"];
  for (const a of all) {
    assert.notEqual(confirmRoute(held, a), "jupiter", a);
    assert.equal(confirmRoute(withBuy, a), "jupiter", a);
  }
  assert.equal(confirmRoute(held, "ok"), "panda");
});
