import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { ineligibleHolders, isOrdinaryWallet } from "./eligible";
import { computeHolderCredits } from "./split";
import { PANDA_TREASURY } from "@/lib/pump/constants";

const addr = () => Keypair.generate().publicKey.toBase58();
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// The payout once compared against a mistyped System Program address: every funded wallet looked like "a program's
// account" and would have been left out of every payout. The real address is checked here.
test("an ordinary wallet is one the System Program owns (or that has no account yet); anything a program owns is not", () => {
  assert.equal(isOrdinaryWallet("11111111111111111111111111111111"), true);
  assert.equal(isOrdinaryWallet(SystemProgram.programId.toBase58()), true);
  assert.equal(isOrdinaryWallet(null), true, "never funded");
  assert.equal(isOrdinaryWallet(undefined), true);
  assert.equal(isOrdinaryWallet(PUMP), false, "the bonding curve");
  assert.equal(isOrdinaryWallet("11111111111111111111111111111111111111112"), false);
});

test("left out: program-owned accounts (the bonding curve) and PANDA's own wallets — ordinary wallets stay, however many there are", async () => {
  const curve = addr();
  const people = Array.from({ length: 230 }, addr); // more than one getMultipleAccounts call
  const unfunded = addr();
  const owners = new Map<string, string | null>([[curve, PUMP], [unfunded, null], ...people.map((p) => [p, SystemProgram.programId.toBase58()] as [string, string])]);
  let calls = 0;
  const connection = {
    getAccountInfo: async () => null, // the coin has no fee-sharing account in this test
    getMultipleAccountsInfo: async (keys: PublicKey[]) => {
      calls++;
      assert.ok(keys.length <= 100);
      return keys.map((k) => {
        const o = owners.get(k.toBase58());
        return o ? { owner: new PublicKey(o) } : null;
      });
    },
  } as never;
  const out = await ineligibleHolders(connection, addr(), [curve, unfunded, PANDA_TREASURY.toBase58(), ...people]);
  assert.equal(out.has(curve), true);
  assert.equal(out.has(PANDA_TREASURY.toBase58()), true);
  assert.equal(out.has(unfunded), false);
  assert.equal(people.some((p) => out.has(p)), false);
  assert.equal(calls, 3);
});

test("the split happens AFTER leaving them out: the bonding curve's 98% no longer swallows the Holders share", () => {
  const curve = "curve";
  const all = [{ address: curve, amount: BigInt(986_800_000) }, { address: "ana", amount: BigInt(6_000_000) }, { address: "luis", amount: BigInt(2_000_000) }];
  const before = computeHolderCredits(all, 18_337_000).credits;
  assert.ok(before.find((c) => c.address === curve)!.lamports > 18_000_000, "what used to happen: almost everything to the curve");
  const after = computeHolderCredits(all.filter((h) => h.address !== curve), 18_337_000);
  assert.deepEqual(after.credits, [{ address: "ana", lamports: 13_752_750 }, { address: "luis", lamports: 4_584_250 }]);
  assert.equal(after.credits.reduce((s, c) => s + c.lamports, 0) + after.dust, 18_337_000, "every lamport accounted for");
});
