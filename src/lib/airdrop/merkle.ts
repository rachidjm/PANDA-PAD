import { createHash } from "node:crypto";

/**
 * Merkle tree over an epoch's allocations, so anyone can check that a
 * (wallet, amount) pair belongs to the published root without seeing the
 * whole list, and any tampering with the list changes the root.
 *
 * Hardening choices:
 *  - leaves and inner nodes are hashed under different prefixes (0x00 / 0x01),
 *    so an inner node can never be passed off as a leaf;
 *  - an unpaired node is promoted as-is (never duplicated), so a list with a
 *    repeated last entry can't collide with the list without it;
 *  - the published root commits to the leaf COUNT as well (prefix 0x02).
 */

export type ProofStep = { hash: string; side: "L" | "R" };

const sha = (...parts: (Buffer | string)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

export const leafHash = (epoch: number, wallet: string, amount: string): Buffer =>
  sha(Buffer.from([0x00]), `${epoch}:${wallet}:${amount}`);

const nodeHash = (left: Buffer, right: Buffer) => sha(Buffer.from([0x01]), left, right);

const commit = (top: Buffer, count: number) => {
  const c = Buffer.alloc(4);
  c.writeUInt32BE(count);
  return sha(Buffer.from([0x02]), c, top).toString("hex");
};

export type MerkleTree = { root: string; count: number; layers: Buffer[][] };

export function buildTree(leaves: Buffer[]): MerkleTree {
  if (leaves.length === 0) throw new Error("Can't build a Merkle tree with no leaves.");
  const layers: Buffer[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? nodeHash(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  return { root: commit(layers[layers.length - 1][0], leaves.length), count: leaves.length, layers };
}

export function proofFor(tree: MerkleTree, index: number): ProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= tree.count) throw new RangeError("Leaf index out of range.");
  const proof: ProofStep[] = [];
  let i = index;
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const layer = tree.layers[level];
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < layer.length) proof.push({ hash: layer[sibling].toString("hex"), side: i % 2 === 0 ? "R" : "L" });
    i = Math.floor(i / 2);
  }
  return proof;
}

/** The sides a proof for leaf `index` in a tree of `count` leaves must have, in order — position fully determines the path shape. */
export function expectedSides(index: number, count: number): ("L" | "R")[] {
  const sides: ("L" | "R")[] = [];
  let i = index;
  let width = count;
  while (width > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < width) sides.push(i % 2 === 0 ? "R" : "L");
    i = Math.floor(i / 2);
    width = Math.ceil(width / 2);
  }
  return sides;
}

/**
 * True only if `leaf` plus `proof` reproduces exactly `root` for a tree of `count`
 * leaves, AND the proof has exactly the shape (length and sides) that leaf
 * `index` must have — so a shorter proof can't present an inner node as a leaf.
 * Never throws.
 */
export function verifyProof(leaf: Buffer, proof: ProofStep[], root: string, count: number, index: number): boolean {
  try {
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(index) || index < 0 || index >= count) return false;
    const sides = expectedSides(index, count);
    if (proof.length !== sides.length || proof.some((s, k) => s.side !== sides[k])) return false;
    let acc = leaf;
    for (const step of proof) {
      if (!/^[0-9a-f]{64}$/.test(step.hash) || (step.side !== "L" && step.side !== "R")) return false;
      const sib = Buffer.from(step.hash, "hex");
      acc = step.side === "L" ? nodeHash(sib, acc) : nodeHash(acc, sib);
    }
    return commit(acc, count) === root;
  } catch {
    return false;
  }
}
