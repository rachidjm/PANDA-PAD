import { test } from "node:test";
import assert from "node:assert/strict";
import { afterAnswer, connectStep, type ConnectInput, connectPlan, readyToReconnect } from "./connect-flow";

const base: ConnectInput = { referralsOn: true, hasPendingLink: false, hasPendingCode: false, answeredBefore: false, walletInstalled: true, mobile: false };

test("connectStep: a fresh visitor with a wallet installed sees the modal first (no code yet)", () => {
  assert.equal(connectStep(base), "modal");
});

test("connectStep: a visitor who came through a ?ref= link or /r/ code connects straight away", () => {
  assert.equal(connectStep({ ...base, hasPendingLink: true }), "connect");
});

test("connectStep: a code already typed (pending in this browser) connects straight away", () => {
  assert.equal(connectStep({ ...base, hasPendingCode: true }), "connect");
});

test("connectStep: a browser that already answered the question connects straight away (returning wallet)", () => {
  assert.equal(connectStep({ ...base, answeredBefore: true }), "connect");
});

test("connectStep: with the Recruiters program off, the modal never shows", () => {
  assert.equal(connectStep({ ...base, referralsOn: false }), "connect");
});

test("connectStep: on a phone without the Phantom app's browser, a skipped modal opens PANDA inside Phantom", () => {
  assert.equal(connectStep({ ...base, walletInstalled: false, mobile: true, answeredBefore: true }), "redirect");
});

test("connectStep: on a desktop without a wallet, a skipped modal shows the install link instead of connecting", () => {
  assert.equal(connectStep({ ...base, walletInstalled: false, answeredBefore: true }), "install");
});

test("afterAnswer: the modal's own answer goes the same way as a skipped one — connect, open Phantom, or install", () => {
  assert.equal(afterAnswer({ walletInstalled: true, mobile: true }), "connect");
  assert.equal(afterAnswer({ walletInstalled: false, mobile: true }), "redirect");
  assert.equal(afterAnswer({ walletInstalled: false, mobile: false }), "install");
});

// ── connecting from wherever things really are ──────────────────────────────────────────────────────────────────────

test("the normal cases: a selected wallet is connected; no wallet selected → select it (that opens the wallet)", () => {
  assert.deepEqual(connectPlan({ walletSelected: true, libraryConnected: false, adapterConnected: false }), { resetAdapter: false, how: "connect" });
  assert.deepEqual(connectPlan({ walletSelected: false, libraryConnected: false, adapterConnected: false }), { resetAdapter: false, how: "select" });
});

test("the 'dead button' state — the adapter connected behind the library's back — is reset first and then selected again", () => {
  // What 'Cambiar de cuenta' used to leave behind: the site shows 'Conectar wallet', the adapter says it is connected,
  // and any further connect returns at once without a word.
  assert.deepEqual(connectPlan({ walletSelected: false, libraryConnected: false, adapterConnected: true }), { resetAdapter: true, how: "select" });
  assert.deepEqual(connectPlan({ walletSelected: true, libraryConnected: false, adapterConnected: true }), { resetAdapter: true, how: "select" });
  // Really connected: nothing to reset.
  assert.equal(connectPlan({ walletSelected: true, libraryConnected: true, adapterConnected: true }).resetAdapter, false);
});

test("'Cambiar de cuenta' reconnects only AFTER the disconnect has really finished — never while it is still in flight", () => {
  const s = { switching: true, libraryConnected: false, connecting: false, disconnecting: false };
  assert.equal(readyToReconnect(s), true);
  assert.equal(readyToReconnect({ ...s, libraryConnected: true }), false, "still connected: the disconnect hasn't landed");
  assert.equal(readyToReconnect({ ...s, disconnecting: true }), false);
  assert.equal(readyToReconnect({ ...s, connecting: true }), false);
  assert.equal(readyToReconnect({ ...s, switching: false }), false, "an ordinary disconnect never reconnects by itself");
});
