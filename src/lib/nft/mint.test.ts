import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getCreateV2InstructionDataSerializer, MPL_CORE_PROGRAM_ID } from "@metaplex-foundation/mpl-core";
import { AssetLike, buildMintTransaction, expectedAttributes, ExpectedAsset, verifyAsset } from "./mint";

const wallet = Keypair.generate().publicKey.toBase58();
const asset = Keypair.generate().publicKey.toBase58();
const theme = { title: "CyberPanda", themeId: 7 };

const expected: ExpectedAsset = {
  assetAddress: asset,
  owner: wallet,
  name: "Cyber Panda #1",
  uri: "https://blob.example/nft/metadata/abc.json",
  royaltyBps: 500,
  attributes: expectedAttributes(theme, "f".repeat(64)),
};

// ---- building the transaction ---------------------------------------------

test("the built transaction is a single Core create: the wallet pays and owns, the asset key co-signs, and the plugins are exactly the safe set", async () => {
  const built = await buildMintTransaction({
    rpcUrl: "http://127.0.0.1:1", // never contacted: the blockhash is injected
    wallet,
    expected,
    blockhash: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 12345 },
  });
  assert.equal(built.lastValidBlockHeight, 12345);

  const tx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  assert.equal(keys[0], wallet, "the wallet is the fee payer");
  assert.equal(tx.message.header.numRequiredSignatures, 2, "the wallet and the new asset must sign — nothing else");
  assert.equal(keys[1], asset);
  assert.ok(tx.signatures.every((s) => s.every((b) => b === 0)), "nothing is pre-signed: the server holds no key that signs this");

  const ixs = tx.message.compiledInstructions;
  const core = ixs.filter((ix) => keys[ix.programIdIndex] === MPL_CORE_PROGRAM_ID);
  assert.equal(core.length, 1, "exactly one Core instruction");
  const other = ixs.filter((ix) => keys[ix.programIdIndex] !== MPL_CORE_PROGRAM_ID).map((ix) => keys[ix.programIdIndex]);
  assert.deepEqual(other, [], "no other program is invoked (no hidden transfers)");

  const data = getCreateV2InstructionDataSerializer().deserialize(Buffer.from(core[0].data))[0];
  assert.equal(data.name, expected.name);
  assert.equal(data.uri, expected.uri);
  const plugins = (data.plugins as { __option: string; value?: unknown } | null | unknown[]) as unknown;
  const list = (Array.isArray(plugins) ? plugins : (plugins as { value: unknown[] }).value) as { plugin: { __kind: string }; authority: { __option: string; value?: { __kind: string } } }[];
  assert.deepEqual(list.map((p) => p.plugin.__kind).sort(), ["AddBlocker", "Attributes", "ImmutableMetadata", "Royalties"]);
  for (const p of list.filter((x) => ["Royalties", "Attributes"].includes(x.plugin.__kind))) {
    const auth = p.authority as unknown as { __option?: string; value?: { __kind: string }; __kind?: string };
    const kind = auth.__kind ?? auth.value?.__kind;
    assert.equal(kind, "None", `${p.plugin.__kind} has authority None`);
  }
});

test("the fee payer/owner in the transaction is the session wallet, whatever else is supplied", async () => {
  const other = Keypair.generate().publicKey.toBase58();
  const built = await buildMintTransaction({
    rpcUrl: "http://127.0.0.1:1",
    wallet: other,
    expected: { ...expected, owner: other },
    blockhash: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 },
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(built.transactionBase64, "base64"));
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), other);
});

// ---- verifying what is on-chain ------------------------------------------------

const good = (): AssetLike => ({
  publicKey: asset,
  owner: wallet,
  name: expected.name,
  uri: expected.uri,
  key: 1,
  seq: undefined,
  updateAuthority: { type: "Address", address: wallet },
  pluginHeader: { key: 3 },
  immutableMetadata: { authority: { type: "None" } },
  addBlocker: { authority: { type: "UpdateAuthority" } },
  royalties: { authority: { type: "None" }, basisPoints: 500, creators: [{ address: wallet, percentage: 100 }], ruleSet: { type: "None" } },
  attributes: { authority: { type: "None" }, attributeList: expected.attributes.map((a) => ({ ...a })) },
  lifecycleHooks: [],
  oracles: undefined,
});

test("an asset that is exactly what PANDA specified verifies", () => {
  assert.equal(verifyAsset(good(), expected), null);
});

test("every deviation is caught", () => {
  const cases: [string, (a: AssetLike) => void][] = [
    ["different asset address", (a) => (a.publicKey = Keypair.generate().publicKey.toBase58())],
    ["different owner", (a) => (a.owner = Keypair.generate().publicKey.toBase58())],
    ["different name", (a) => (a.name = "Other")],
    ["different uri", (a) => (a.uri = "https://evil.example/x.json")],
    ["update authority is a collection", (a) => (a.updateAuthority = { type: "Collection", address: asset })],
    ["update authority is someone else", (a) => (a.updateAuthority = { type: "Address", address: Keypair.generate().publicKey.toBase58() })],
    ["update authority none", (a) => (a.updateAuthority = { type: "None" })],
    ["metadata not immutable (plugin missing)", (a) => delete a.immutableMetadata],
    ["royalties missing", (a) => delete a.royalties],
    ["royalty bps differs", (a) => a.royalties && (a.royalties.basisPoints = 1000)],
    ["royalty authority not none", (a) => a.royalties && (a.royalties.authority = { type: "UpdateAuthority" })],
    ["royalty rule set enforced elsewhere", (a) => a.royalties && (a.royalties.ruleSet = { type: "ProgramAllowList" })],
    ["royalty paid to someone else", (a) => a.royalties && (a.royalties.creators = [{ address: Keypair.generate().publicKey.toBase58(), percentage: 100 }])],
    ["royalty split", (a) => a.royalties && (a.royalties.creators = [{ address: wallet, percentage: 50 }, { address: asset, percentage: 50 }])],
    ["attributes missing", (a) => delete a.attributes],
    ["attributes changeable", (a) => a.attributes && (a.attributes.authority = { type: "UpdateAuthority" })],
    ["attribute value differs", (a) => a.attributes && (a.attributes.attributeList[2].value = "0".repeat(64))],
    ["attribute added", (a) => a.attributes && a.attributes.attributeList.push({ key: "Extra", value: "x" })],
    ["attribute removed", (a) => a.attributes && a.attributes.attributeList.pop()],
    // The dangerous ones: plugins a creator could add to their own transaction to claw an NFT back from a buyer.
    ["permanent transfer delegate", (a) => (a.permanentTransferDelegate = { authority: { type: "Address", address: wallet } })],
    ["permanent freeze delegate", (a) => (a.permanentFreezeDelegate = { authority: { type: "Address", address: wallet }, frozen: true })],
    ["permanent burn delegate", (a) => (a.permanentBurnDelegate = { authority: { type: "Address", address: wallet } })],
    ["transfer delegate", (a) => (a.transferDelegate = { authority: { type: "Address", address: wallet } })],
    ["freeze delegate", (a) => (a.freezeDelegate = { authority: { type: "Owner" }, frozen: true })],
    ["burn delegate", (a) => (a.burnDelegate = { authority: { type: "Owner" } })],
    ["update delegate", (a) => (a.updateDelegate = { authority: { type: "Address", address: wallet }, additionalDelegates: [] })],
    ["not sealed (add blocker missing)", (a) => delete a.addBlocker],
    ["autograph", (a) => (a.autograph = { authority: { type: "Owner" }, signatures: [] })],
    ["lifecycle hook (external adapter)", (a) => (a.lifecycleHooks = [{ type: "LifecycleHook" }])],
    ["oracle (external adapter)", (a) => (a.oracles = [{ type: "Oracle" }])],
    ["an unknown future plugin", (a) => (a.someFuturePlugin = { authority: { type: "None" } })],
  ];
  for (const [label, mutate] of cases) {
    const a = good();
    mutate(a);
    assert.notEqual(verifyAsset(a, expected), null, `should be rejected: ${label}`);
  }
});

test("empty external-adapter arrays and undefined fields are not mistaken for plugins", () => {
  const a = good();
  a.oracles = [];
  a.appDatas = undefined;
  a.linkedAppDatas = null;
  assert.equal(verifyAsset(a, expected), null);
});
