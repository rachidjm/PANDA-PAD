import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceMoved, compactAmount, holdingValue, isRejection, settleByBalance } from "./outcome";

const B = (n: number) => BigInt(n);
const noSleep = async () => {};

test("a buy landed if the coin's balance went UP; a sell if it went DOWN; an unknown read proves nothing", () => {
  assert.equal(balanceMoved("buy", B(0), B(500)), true);
  assert.equal(balanceMoved("buy", B(500), B(500)), false);
  assert.equal(balanceMoved("sell", B(500), B(100)), true);
  assert.equal(balanceMoved("sell", B(500), B(500)), false);
  assert.equal(balanceMoved("buy", null, B(500)), null);
  assert.equal(balanceMoved("buy", B(1), null), null);
});

test("the wallet said 'error' but the buy landed: the balance shows it a few reads later → landed, not failed", async () => {
  const reads = [B(100), B(100), B(350)];
  let n = 0;
  const r = await settleByBalance({ side: "buy", beforeRaw: B(100), read: async () => reads[Math.min(n++, reads.length - 1)], sleep: noSleep });
  assert.equal(r, "landed");
  assert.equal(n, 3, "it stops looking as soon as it sees it");
});

test("nothing ever moves: not seen (so a real failure is still shown as a failure)", async () => {
  let n = 0;
  const r = await settleByBalance({ side: "buy", beforeRaw: B(100), read: async () => (n++, B(100)), sleep: noSleep, attempts: 4 });
  assert.equal(r, "not_seen");
  assert.equal(n, 4);
});

test("reads that fail are tried again and never throw; without a 'before' there is nothing to compare", async () => {
  let n = 0;
  const flaky = async () => {
    if (n++ < 2) throw new Error("rpc 429");
    return B(10);
  };
  assert.equal(await settleByBalance({ side: "sell", beforeRaw: B(50), read: flaky, sleep: noSleep }), "landed");
  assert.equal(await settleByBalance({ side: "buy", beforeRaw: null, read: async () => B(1), sleep: noSleep }), "not_seen");
});

test("only a refusal in the wallet counts as 'rejected' — a wallet's vague error doesn't", () => {
  const walletError = (message: string) => Object.assign(new Error(message), { name: "WalletSendTransactionError" });
  assert.equal(isRejection(walletError("User rejected the request.")), true);
  assert.equal(isRejection(new Error("User rejected the request.")), true);
  assert.equal(isRejection(walletError("Unexpected error")), false);
  assert.equal(isRejection(new Error("Transaction failed to confirm in time.")), false);
});

test("holdings line: a short amount and its value, in the page's language", () => {
  assert.equal(compactAmount(5_370_000, "es"), "5,37 M");
  assert.equal(compactAmount(5_370_000, "en"), "5.37M");
  assert.equal(compactAmount(1250.4, "en"), "1,250");
  assert.equal(compactAmount(12.345, "en"), "12.35");
  assert.equal(compactAmount(0, "en"), "0");
  assert.equal(holdingValue(1000, 0.0188, "en"), "$18.80");
  assert.match(holdingValue(1000, 0.0188, "es")!, /^18,80\s\$$/);
  assert.equal(holdingValue(1, 0.000001, "en"), "< $0.01");
  assert.equal(holdingValue(10, null, "en"), null);
  assert.equal(holdingValue(0, 1, "en"), null);
});
