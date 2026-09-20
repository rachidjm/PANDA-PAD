import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTotals } from "@/lib/epochs/totals";
import { applyAward, emptyWalletDoc } from "@/lib/points/events";
import { allocationIsIntact, computeAllocations } from "./allocate";
import { buildTree, leafHash, proofFor, verifyProof } from "./merkle";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const totalsOf = (pointsByWallet: Record<string, number>, epoch = 1) =>
  buildTotals(
    epoch,
    "v1",
    Object.entries(pointsByWallet).map(([wallet, points]) =>
      applyAward(emptyWalletDoc(wallet, epoch), { eventId: `evt-${wallet}-campaign`, wallet, type: "campaign", source: "t", ts: 5, points, epoch, reason: "r" }, 1).next
    )
  );

// ---- allocation ----------------------------------------------------------

test("proportional split, exact, with the remainder reported as dust", () => {
  const a = computeAllocations(totalsOf({ A: 1, B: 2, C: 4 }), BigInt(1000));
  // floor(1000/7)=142, floor(2000/7)=285, floor(4000/7)=571 -> 998, dust 2
  assert.deepEqual(a.entries.map((e) => e.amount), ["142", "285", "571"]);
  assert.equal(a.distributed, "998");
  assert.equal(a.dust, "2");
  assert.equal(a.dustPolicy, "carry_forward");
  assert.equal(allocationIsIntact(a), true);
});

test("fuzz: for any pool and any weights, sum + dust == pool, sum <= pool, all amounts positive (incl. pools above 2^53)", () => {
  const rand = rng(11);
  for (let run = 0; run < 400; run++) {
    const n = 1 + Math.floor(rand() * 80);
    const pts: Record<string, number> = {};
    for (let i = 0; i < n; i++) pts[`W${String(i).padStart(3, "0")}`] = 1 + Math.floor(rand() * 20_000);
    const pool = BigInt(Math.floor(rand() * 1e15)) * BigInt(Math.floor(rand() * 1e9) + 1) + BigInt(Math.floor(rand() * 1000));
    const a = computeAllocations(totalsOf(pts), pool);
    const sum = a.entries.reduce((s, e) => s + BigInt(e.amount), BigInt(0));
    assert.equal(sum + BigInt(a.dust), pool);
    assert.ok(sum <= pool);
    assert.ok(a.entries.every((e) => BigInt(e.amount) > BigInt(0)));
    assert.ok(BigInt(a.dust) < BigInt(n), "dust is less than one base unit per recipient");
    assert.equal(allocationIsIntact(a), true);
  }
});

test("more points never means a smaller amount (monotonic), equal points get equal amounts", () => {
  const a = computeAllocations(totalsOf({ A: 10, B: 10, C: 500, D: 3 }), BigInt("123456789012345678"));
  const amt = Object.fromEntries(a.entries.map((e) => [e.wallet, BigInt(e.amount)]));
  assert.equal(amt.A, amt.B);
  assert.ok(amt.C > amt.A && amt.A > amt.D);
});

test("a wallet whose share rounds to zero is dropped, and its share stays in the dust", () => {
  const a = computeAllocations(totalsOf({ BIG: 1_000_000, TINY: 1 }), BigInt(10));
  assert.deepEqual(a.entries.map((e) => e.wallet), ["BIG"]);
  assert.equal(BigInt(a.distributed) + BigInt(a.dust), BigInt(10));
});

test("refuses: empty epoch, negative pool, tampered totals", () => {
  assert.throws(() => computeAllocations(buildTotals(1, "v1", []), BigInt(100)));
  assert.throws(() => computeAllocations(totalsOf({ A: 1 }), BigInt(-1)));
  const t = totalsOf({ A: 1, B: 2 });
  assert.throws(() => computeAllocations({ ...t, totalPoints: t.totalPoints + 1 }, BigInt(100)));
  assert.throws(() => computeAllocations({ ...t, entries: [{ wallet: "A", points: 999 }, t.entries[1]] }, BigInt(100)));
});

test("deterministic: same inputs, same hash; different pool or points, different hash", () => {
  const t = totalsOf({ A: 1, B: 2 });
  assert.equal(computeAllocations(t, BigInt(1000)).allocationHash, computeAllocations(t, BigInt(1000)).allocationHash);
  assert.notEqual(computeAllocations(t, BigInt(1000)).allocationHash, computeAllocations(t, BigInt(1001)).allocationHash);
  assert.notEqual(computeAllocations(t, BigInt(1000)).allocationHash, computeAllocations(totalsOf({ A: 2, B: 2 }), BigInt(1000)).allocationHash);
});

test("a stored allocation set that was edited fails its integrity check", () => {
  const a = computeAllocations(totalsOf({ A: 1, B: 2 }), BigInt(1000));
  assert.equal(allocationIsIntact({ ...a, entries: [{ ...a.entries[0], amount: "999" }, a.entries[1]] }), false);
  assert.equal(allocationIsIntact({ ...a, pool: "1001" }), false);
  assert.equal(allocationIsIntact({ ...a, dust: "0" }), false);
  assert.equal(allocationIsIntact({ ...a, entries: [a.entries[0], a.entries[0]] }), false);
  assert.equal(allocationIsIntact({ ...a, allocationHash: "0".repeat(64) }), false);
});

// ---- merkle --------------------------------------------------------------

const leaves = (n: number) => Array.from({ length: n }, (_, i) => leafHash(1, `W${i}`, String(1000 + i)));

test("every leaf's proof verifies, for every tree size from 1 to 70", () => {
  for (let n = 1; n <= 70; n++) {
    const tree = buildTree(leaves(n));
    for (let i = 0; i < n; i++) {
      assert.equal(verifyProof(leaves(n)[i], proofFor(tree, i), tree.root, n, i), true, `n=${n} i=${i}`);
    }
  }
});

test("a proof only works for its own leaf, amount, wallet, epoch, root and leaf count", () => {
  const n = 13;
  const tree = buildTree(leaves(n));
  const proof = proofFor(tree, 5);
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, tree.root, n, 5), true);
  assert.equal(verifyProof(leafHash(1, "W5", "1006"), proof, tree.root, n, 5), false, "amount");
  assert.equal(verifyProof(leafHash(1, "W6", "1005"), proof, tree.root, n, 5), false, "wallet");
  assert.equal(verifyProof(leafHash(2, "W5", "1005"), proof, tree.root, n, 5), false, "epoch");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, "0".repeat(64), n, 5), false, "root");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, tree.root, n + 1, 5), false, "leaf count");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, tree.root, n, 4), false, "wrong position");
  assert.equal(verifyProof(leafHash(1, "W4", "1004"), proof, tree.root, n, 5), false, "another leaf, same proof");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof.slice(1), tree.root, n, 5), false, "truncated proof");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), [...proof].reverse(), tree.root, n, 5), false, "reordered proof");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof.map((s) => ({ ...s, side: s.side === "L" ? "R" : "L" }) as never), tree.root, n, 5), false, "flipped sides");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, tree.root, n, -1), false, "negative index");
  assert.equal(verifyProof(leafHash(1, "W5", "1005"), proof, tree.root, n, n), false, "index past the end");
});

test("malformed proofs are rejected, never thrown", () => {
  const tree = buildTree(leaves(4));
  const leaf = leafHash(1, "W1", "1001");
  assert.equal(verifyProof(leaf, [{ hash: "zz", side: "L" }], tree.root, 4, 1), false);
  assert.equal(verifyProof(leaf, [{ hash: "a".repeat(64), side: "X" as never }], tree.root, 4, 1), false);
  assert.equal(verifyProof(leaf, Array(50).fill({ hash: "a".repeat(64), side: "L" }), tree.root, 4, 1), false);
  assert.equal(verifyProof(leaf, [], tree.root, 0, 0), false);
  assert.equal(verifyProof(leaf, [], tree.root, NaN, 0), false);
  assert.equal(verifyProof(leaf, [], tree.root, 4, NaN), false);
  assert.equal(verifyProof(leaf, null as never, tree.root, 4, 1), false);
});

test("an inner node can't be passed off as a leaf (domain separation)", () => {
  const tree = buildTree(leaves(4));
  const inner = tree.layers[1][0]; // hash of leaves 0 and 1
  // An attacker who presents the inner node with the shorter proof that "works" hash-wise is rejected on shape.
  assert.equal(verifyProof(inner, proofFor(tree, 0).slice(1), tree.root, 4, 0), false);
  assert.equal(verifyProof(inner, proofFor(tree, 0).slice(1), tree.root, 4, 1), false);
  assert.equal(verifyProof(inner, proofFor(tree, 0).slice(1), tree.root, 2, 0), false);
  // And a leaf hash can only be produced from a (epoch, wallet, amount) preimage under the 0x00 prefix.
  assert.notDeepEqual(leafHash(1, "W0", "1000"), inner);
});

test("the root commits to the leaf count: a repeated last entry can't collide with the shorter list", () => {
  const three = leaves(3);
  const four = [...three, three[2]];
  assert.notEqual(buildTree(three).root, buildTree(four).root);
});

test("root is deterministic and changes with any leaf", () => {
  assert.equal(buildTree(leaves(9)).root, buildTree(leaves(9)).root);
  const l = leaves(9);
  l[4] = leafHash(1, "W4", "9999");
  assert.notEqual(buildTree(l).root, buildTree(leaves(9)).root);
  assert.throws(() => buildTree([]));
  assert.throws(() => proofFor(buildTree(leaves(3)), 3));
  assert.throws(() => proofFor(buildTree(leaves(3)), -1));
});
