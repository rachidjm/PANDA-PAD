import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { AssetLike, expectedAttributes, ExpectedAsset, verifyAsset } from "./mint";

const k = () => Keypair.generate().publicKey.toBase58();
const creator = k();
const seller = k();
const market = k();
const asset = k();

const expected: ExpectedAsset = {
  assetAddress: asset,
  owner: seller,
  creator,
  name: "Cyber Panda #1",
  uri: "https://blob.example/nft/metadata/abc.json",
  royaltyBps: 500,
  attributes: expectedAttributes({ title: "CyberPanda", themeId: 7 }, "f".repeat(64)),
};

/** An NFT that was minted by `creator` and is now owned by `seller`. */
const resold = (): AssetLike => ({
  publicKey: asset,
  owner: seller,
  name: expected.name,
  uri: expected.uri,
  updateAuthority: { type: "Address", address: creator },
  immutableMetadata: { authority: { type: "None" } },
  addBlocker: { authority: { type: "UpdateAuthority" } },
  royalties: { authority: { type: "None" }, basisPoints: 500, creators: [{ address: creator, percentage: 100 }], ruleSet: { type: "None" } },
  attributes: { authority: { type: "None" }, attributeList: expected.attributes.map((a) => ({ ...a })) },
});

const listed = (): AssetLike => ({ ...resold(), transferDelegate: { authority: { type: "Address", address: market } } });

test("an NFT that changed hands verifies: the OWNER is the seller, the CREATOR is still the update authority and royalty recipient", () => {
  assert.equal(verifyAsset(resold(), expected), null);
  const a = resold();
  a.updateAuthority = { type: "Address", address: seller };
  assert.notEqual(verifyAsset(a, expected), null, "update authority must stay the creator");
  const b = resold();
  if (b.royalties) b.royalties.creators = [{ address: seller, percentage: 100 }];
  assert.notEqual(verifyAsset(b, expected), null, "royalties must still go to the creator, not the reseller");
});

test("a listing looks like: PANDA's market as TransferDelegate — allowed only when the market authority is given, and only that exact address", () => {
  const opts = { marketAuthority: market };
  assert.equal(verifyAsset(listed(), expected, opts), null);
  assert.equal(verifyAsset(listed(), expected, { ...opts, requireMarketDelegate: true }), null);

  assert.match(verifyAsset(listed(), expected) ?? "", /unexpected plugin: transferDelegate/, "not allowed unless the market is in play");

  const other = listed();
  other.transferDelegate = { authority: { type: "Address", address: k() } };
  assert.match(verifyAsset(other, expected, opts) ?? "", /unexpected transfer delegate/, "someone else's delegate is refused");

  for (const authority of [{ type: "Owner" }, { type: "UpdateAuthority" }, { type: "None" }]) {
    const a = listed();
    a.transferDelegate = { authority };
    assert.match(verifyAsset(a, expected, opts) ?? "", /unexpected transfer delegate/, authority.type);
  }
});

test("requiring the delegate: an asset PANDA can't actually move is not a valid listing", () => {
  assert.match(verifyAsset(resold(), expected, { marketAuthority: market, requireMarketDelegate: true }) ?? "", /not approved/);
});

test("the market never relaxes the other rules: freeze/burn delegates, permanent plugins and hooks are still refused", () => {
  const opts = { marketAuthority: market, requireMarketDelegate: true };
  const cases: [string, (a: AssetLike) => void][] = [
    ["freeze delegate (a frozen NFT can't be transferred)", (a) => (a.freezeDelegate = { authority: { type: "Owner" }, frozen: true })],
    ["burn delegate", (a) => (a.burnDelegate = { authority: { type: "Address", address: market } })],
    ["permanent transfer delegate", (a) => (a.permanentTransferDelegate = { authority: { type: "Address", address: creator } })],
    ["lifecycle hook", (a) => (a.lifecycleHooks = [{ type: "LifecycleHook" }])],
    ["wrong owner", (a) => (a.owner = k())],
    ["royalty changed", (a) => a.royalties && (a.royalties.basisPoints = 0)],
  ];
  for (const [label, mutate] of cases) {
    const a = listed();
    mutate(a);
    assert.notEqual(verifyAsset(a, expected, opts), null, label);
  }
});
