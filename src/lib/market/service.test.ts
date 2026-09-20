import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { verifyEd25519 } from "@/lib/auth/wallet-auth";
import { AssetLike, expectedAttributes } from "@/lib/nft/mint";
import { NftRecord, saveRecord } from "@/lib/nft/store";
import { buildCancelTransaction, buildListTransaction, buildSaleTransaction, ParsedTxLike } from "./chain";
import { toParsed } from "./chain-test-utils";
import { MARKET_CONFIG } from "./config";
import { cancelListing, confirmListing, confirmSale, MarketDeps, marketStats, prepareBuy, prepareListing } from "./service";
import { getGate, getListing, updateListing } from "./store";

const H = 3_600_000;
const SOL = 1_000_000_000;
const RPC = "http://127.0.0.1:1";
const BH = { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 777 };
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

const market = Keypair.generate();
const treasury = Keypair.generate().publicKey.toBase58();
const person = () => Keypair.generate();
const b58 = (k: Keypair) => k.publicKey.toBase58();
const signMessage = (kp: Keypair, message: string) =>
  bs58.encode(nodeSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(kp.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" })));

let clock = 1_800_000_000_000;
let idn = 0;
let sigCounter = 0;
const fakeSig = () => bs58.encode(Buffer.from(String(++sigCounter).padStart(64, "0")));

// ---- a fake chain -----------------------------------------------------------------------

type ChainAsset = { owner: string; creator: string; delegate: string | null; extra: string | null; record: NftRecord };
class FakeChain {
  assets = new Map<string, ChainAsset>();
  landed = new Map<string, ParsedTxLike>();
  recent = new Map<string, string[]>();
  builtSales: { base64: string; asset: string; buyer: string }[] = [];

  toAssetLike(addr: string): AssetLike | null {
    const a = this.assets.get(addr);
    if (!a) return null;
    const r = a.record;
    const like: AssetLike = {
      publicKey: addr,
      owner: a.owner,
      name: r.name,
      uri: r.metadataUri,
      updateAuthority: { type: "Address", address: a.creator },
      immutableMetadata: { authority: { type: "None" } },
      addBlocker: { authority: { type: "UpdateAuthority" } },
      royalties: { authority: { type: "None" }, basisPoints: r.royaltyBps, creators: [{ address: a.creator, percentage: 100 }], ruleSet: { type: "None" } },
      attributes: { authority: { type: "None" }, attributeList: expectedAttributes({ title: r.themeTitle, themeId: r.themeId }, r.sha256) },
    };
    if (a.delegate) like.transferDelegate = { authority: { type: "Address", address: a.delegate } };
    if (a.extra) like[a.extra] = { authority: { type: "Address", address: a.creator } };
    return like;
  }
  /** The sale transaction "lands": the NFT changes hands and the transaction is queryable. */
  land(base64: string, asset: string, buyer: string, signature = fakeSig()) {
    this.landed.set(signature, toParsed(base64));
    this.recent.set(asset, [signature, ...(this.recent.get(asset) ?? [])]);
    const a = this.assets.get(asset);
    if (a) {
      a.owner = buyer;
      a.delegate = null; // Core revokes owner-managed delegates on transfer
    }
    return signature;
  }
}

function harness(over: Partial<MarketDeps> = {}, allowSecondary = true) {
  const chain = new FakeChain();
  const alerts: string[] = [];
  const deps: MarketDeps = {
    now: () => clock,
    newId: () => `id-${++idn}-${Math.random().toString(36).slice(2, 10)}`,
    marketAuthority: b58(market),
    treasury,
    domain: "panda.test",
    allowSecondary,
    fetchAsset: async (a) => chain.toAssetLike(a),
    buildListTx: (seller, asset) => buildListTransaction({ rpcUrl: RPC, seller, asset, marketAuthority: b58(market), blockhash: BH }),
    buildCancelTx: (seller, asset) => buildCancelTransaction({ rpcUrl: RPC, seller, asset, blockhash: BH }),
    buildSaleTx: async (buyer, asset, payments) => {
      const built = await buildSaleTransaction({ rpcUrl: RPC, market, buyer, asset, payments, blockhash: BH });
      chain.builtSales.push({ base64: built.transactionBase64, asset, buyer });
      return built;
    },
    getParsedTx: async (sig) => chain.landed.get(sig) ?? null,
    recentSignatures: async (asset, limit) => (chain.recent.get(asset) ?? []).slice(0, limit),
    verifySignature: (message, sig, wallet) => {
      try {
        return verifyEd25519(new TextEncoder().encode(message), bs58.decode(sig), new PublicKey(wallet).toBytes());
      } catch {
        return false;
      }
    },
    alert: async (e) => {
      alerts.push(e);
    },
    ...over,
  };
  return { deps, chain, alerts };
}

let themeSeq = 100;
/** A published NFT created by `creator` (owned by them) on the fake chain. */
async function publishedNft(h: ReturnType<typeof harness>, creator: Keypair, royaltyBps = 500) {
  const themeId = ++themeSeq;
  const asset = Keypair.generate().publicKey.toBase58();
  const rec: NftRecord = {
    contentId: `content-${themeId}-abcdefgh`,
    wallet: b58(creator),
    themeId,
    themeSlug: `theme-${themeId}`,
    themeTitle: `Theme ${themeId}`,
    royaltyBps,
    name: "Cyber Panda",
    description: "d",
    imageUrl: "https://blob.test/nft/images/x.png",
    imageMime: "image/png",
    metadataUri: `https://blob.test/nft/metadata/${themeId}.json`,
    width: 600,
    height: 600,
    pixelHash: "a".repeat(64),
    dhash: "0".repeat(16),
    sha256: "b".repeat(64),
    originalSha256: "c".repeat(64),
    review: "ORIGINAL",
    status: "PUBLISHED",
    assetAddress: asset,
    signature: fakeSig(),
    publishedAt: clock,
    createdAt: clock,
    expiresAt: clock + H,
  };
  await saveRecord(rec);
  h.chain.assets.set(asset, { owner: b58(creator), creator: b58(creator), delegate: null, extra: null, record: rec });
  return { rec, asset };
}

/** Lists an NFT end to end: prepare, the seller approves on-chain and signs the terms, confirm. */
async function listIt(h: ReturnType<typeof harness>, seller: Keypair, rec: NftRecord, price = 2 * SOL) {
  const prep = await prepareListing(h.deps, { wallet: b58(seller), contentId: rec.contentId, priceLamports: price, expiresAt: clock + 48 * H });
  assert.ok(prep.ok, JSON.stringify(prep));
  if (!prep.ok) throw new Error();
  h.chain.assets.get(rec.assetAddress as string)!.delegate = b58(market); // the seller's approval transaction lands
  const conf = await confirmListing(h.deps, { wallet: b58(seller), listingId: prep.listingId, messageSignature: signMessage(seller, prep.message) });
  assert.ok(conf.ok, JSON.stringify(conf));
  return prep;
}

// ---- tests ----------------------------------------------------------------------------

test("PRIMARY SALE, end to end: list -> buy -> the sale is recorded only after the landed transaction verifies; PANDA's fee, no royalty", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const { rec, asset } = await publishedNft(h, creator);

  const listing = await listIt(h, creator, rec, 2 * SOL);
  assert.equal(listing.kind, "primary");
  assert.equal(listing.preview.feeLamports, 40_000_000);
  assert.equal(listing.preview.royaltyLamports, 0);
  assert.equal((await marketStats(rec.themeId, clock)).listed, 1);
  assert.equal((await marketStats(rec.themeId, clock)).floorLamports, 2 * SOL);

  const buy = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: listing.listingId });
  assert.ok(buy.ok, JSON.stringify(buy));
  if (!buy.ok) return;
  assert.equal(buy.kind, "primary");
  assert.deepEqual(buy.payments, [
    { from: b58(buyer), to: b58(creator), lamports: 1_960_000_000 },
    { from: b58(buyer), to: treasury, lamports: 40_000_000 },
  ]);
  assert.equal(buy.payments.reduce((a, p) => a + p.lamports, 0), 2 * SOL, "the buyer pays exactly the listed price");

  // Not landed yet: nothing is recorded, nothing changes hands in our books.
  const early = await confirmSale(h.deps, { buyer: b58(buyer), saleId: buy.saleId });
  assert.ok(!early.ok && early.code === "PENDING");
  assert.equal((await marketStats(rec.themeId, clock)).sales, 0);

  const sig = h.chain.land(h.chain.builtSales[0].base64, asset, b58(buyer));
  const done = await confirmSale(h.deps, { buyer: b58(buyer), saleId: buy.saleId, signature: sig });
  assert.ok(done.ok && !done.alreadyCompleted, JSON.stringify(done));
  const stats = await marketStats(rec.themeId, clock);
  assert.deepEqual({ sales: stats.sales, volume: stats.volumeLamports, listed: stats.listed }, { sales: 1, volume: 2 * SOL, listed: 0 });
  assert.equal((await getListing(listing.listingId))?.status, "SOLD");
  assert.equal((await getGate(asset)).salesCount, 1);
  assert.equal((await getGate(asset)).state, "none");

  const again = await confirmSale(h.deps, { buyer: b58(buyer), saleId: buy.saleId, signature: sig });
  assert.ok(again.ok && again.alreadyCompleted, "confirming twice is harmless");
  assert.equal((await marketStats(rec.themeId, clock)).sales, 1, "and never counts twice");
});

test("SECONDARY SALE: the creator's royalty is paid on top of PANDA's fee, taken from the seller's side; reselling can be switched off", async () => {
  const closed = harness({}, false);
  const creator = person();
  const first = person();
  const second = person();
  const { rec, asset } = await publishedNft(closed, creator);

  // Primary first (allowed even with secondary off).
  const l1 = await listIt(closed, creator, rec, 1 * SOL);
  const b1 = await prepareBuy(closed.deps, { buyer: b58(first), listingId: l1.listingId });
  assert.ok(b1.ok);
  closed.chain.land(closed.chain.builtSales[0].base64, asset, b58(first));
  assert.ok((await confirmSale(closed.deps, { buyer: b58(first), saleId: b1.ok ? b1.saleId : "" })).ok);

  // The new owner can't resell while NFT_SECONDARY is off.
  const refused = await prepareListing(closed.deps, { wallet: b58(first), contentId: rec.contentId, priceLamports: 3 * SOL, expiresAt: clock + 48 * H });
  assert.ok(!refused.ok && refused.code === "SECONDARY_DISABLED");

  // Open the secondary market on the same chain state.
  const open = harness({}, true);
  open.chain = closed.chain;
  const openDeps: MarketDeps = { ...open.deps, fetchAsset: async (a) => closed.chain.toAssetLike(a), buildSaleTx: closed.deps.buildSaleTx, getParsedTx: closed.deps.getParsedTx, recentSignatures: closed.deps.recentSignatures };
  const l2 = await prepareListing(openDeps, { wallet: b58(first), contentId: rec.contentId, priceLamports: 3 * SOL, expiresAt: clock + 48 * H });
  assert.ok(l2.ok, JSON.stringify(l2));
  if (!l2.ok) return;
  assert.equal(l2.kind, "secondary");
  closed.chain.assets.get(asset)!.delegate = b58(market);
  assert.ok((await confirmListing(openDeps, { wallet: b58(first), listingId: l2.listingId, messageSignature: signMessage(first, l2.message) })).ok);

  const buy = await prepareBuy(openDeps, { buyer: b58(second), listingId: l2.listingId });
  assert.ok(buy.ok, JSON.stringify(buy));
  if (!buy.ok) return;
  assert.equal(buy.kind, "secondary");
  assert.deepEqual(buy.payments, [
    { from: b58(second), to: b58(first), lamports: 2_790_000_000 }, // 3 SOL - 2% fee - 5% royalty
    { from: b58(second), to: b58(creator), lamports: 150_000_000 }, // the creator's royalty
    { from: b58(second), to: treasury, lamports: 60_000_000 },
  ]);
  assert.equal(buy.payments.reduce((a, p) => a + p.lamports, 0), 3 * SOL);
});

test("only the on-chain OWNER can list; an NFT with anything extra attached can't be listed; one listing per NFT", async () => {
  const h = harness();
  const creator = person();
  const stranger = person();
  const { rec, asset } = await publishedNft(h, creator);
  const args = { contentId: rec.contentId, priceLamports: SOL, expiresAt: clock + 24 * H };

  const notOwner = await prepareListing(h.deps, { wallet: b58(stranger), ...args });
  assert.ok(!notOwner.ok && notOwner.code === "NOT_OWNER");

  for (const extra of ["permanentTransferDelegate", "freezeDelegate", "burnDelegate", "lifecycleHooks"]) {
    h.chain.assets.get(asset)!.extra = extra;
    const r = await prepareListing(h.deps, { wallet: b58(creator), ...args });
    assert.ok(!r.ok && r.code === "UNSAFE_ASSET", extra);
  }
  h.chain.assets.get(asset)!.extra = null;

  await listIt(h, creator, rec);
  const twice = await prepareListing(h.deps, { wallet: b58(creator), ...args });
  assert.ok(!twice.ok && twice.code === "ALREADY_LISTED");

  const ghost = await prepareListing(h.deps, { wallet: b58(creator), contentId: "does-not-exist-1", priceLamports: SOL, expiresAt: clock + 24 * H });
  assert.ok(!ghost.ok && ghost.code === "NOT_FOUND");
});

test("listing terms are validated: price range, expiry range, and nothing is created for a bad request", async () => {
  const h = harness();
  const creator = person();
  const { rec } = await publishedNft(h, creator);
  for (const priceLamports of [0, MARKET_CONFIG.minPriceLamports - 1, MARKET_CONFIG.maxPriceLamports + 1, 1.5, NaN, "5", null]) {
    const r = await prepareListing(h.deps, { wallet: b58(creator), contentId: rec.contentId, priceLamports, expiresAt: clock + 24 * H });
    assert.ok(!r.ok && r.code === "BAD_TERMS", String(priceLamports));
  }
  for (const expiresAt of [clock, clock + 1000, clock + 40 * 24 * H, "x", null]) {
    const r = await prepareListing(h.deps, { wallet: b58(creator), contentId: rec.contentId, priceLamports: SOL, expiresAt });
    assert.ok(!r.ok && r.code === "BAD_TERMS", String(expiresAt));
  }
  assert.equal((await getGate(rec.assetAddress as string)).state, "none", "no slot was taken");
});

test("confirming a listing needs the seller's own signature over the exact terms, and the on-chain approval to have landed", async () => {
  const h = harness();
  const creator = person();
  const other = person();
  const { rec, asset } = await publishedNft(h, creator);
  const prep = await prepareListing(h.deps, { wallet: b58(creator), contentId: rec.contentId, priceLamports: SOL, expiresAt: clock + 24 * H });
  assert.ok(prep.ok);
  if (!prep.ok) return;

  const noApproval = await confirmListing(h.deps, { wallet: b58(creator), listingId: prep.listingId, messageSignature: signMessage(creator, prep.message) });
  assert.ok(!noApproval.ok && noApproval.code === "PENDING", "the approval transaction hasn't landed");

  h.chain.assets.get(asset)!.delegate = b58(market);
  for (const bad of [signMessage(other, prep.message), signMessage(creator, prep.message + "x"), "", "not-base58!!", 5, null]) {
    const r = await confirmListing(h.deps, { wallet: b58(creator), listingId: prep.listingId, messageSignature: bad });
    assert.ok(!r.ok && r.code === "BAD_SIGNATURE", String(bad));
  }
  const wrongWallet = await confirmListing(h.deps, { wallet: b58(other), listingId: prep.listingId, messageSignature: signMessage(other, prep.message) });
  assert.ok(!wrongWallet.ok && wrongWallet.code === "NOT_FOUND");

  h.chain.assets.get(asset)!.delegate = b58(person());
  const wrongDelegate = await confirmListing(h.deps, { wallet: b58(creator), listingId: prep.listingId, messageSignature: signMessage(creator, prep.message) });
  assert.ok(!wrongDelegate.ok, "approving somebody ELSE as delegate isn't a listing");

  h.chain.assets.get(asset)!.delegate = b58(market);
  const ok = await confirmListing(h.deps, { wallet: b58(creator), listingId: prep.listingId, messageSignature: signMessage(creator, prep.message) });
  assert.ok(ok.ok && !ok.alreadyActive);
});

test("TAMPERING: a price edited in the database, or a swapped signature, can't produce a sale", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const { rec } = await publishedNft(h, creator);
  const prep = await listIt(h, creator, rec, 5 * SOL);

  await updateListing(prep.listingId, (l) => ({ next: l ? { ...l, priceLamports: 1_000_000 } : l, result: null }));
  const cheap = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: prep.listingId });
  assert.ok(!cheap.ok && cheap.code === "LISTING_INVALID", "the signed price was 5 SOL");
  assert.ok(h.alerts.length >= 1, "and it raises an alert");
  assert.equal(h.chain.builtSales.length, 0, "no transaction was ever built or signed");

  await updateListing(prep.listingId, (l) => ({ next: l ? { ...l, priceLamports: 5 * SOL, messageSignature: signMessage(buyer, l.message) } : l, result: null }));
  const forged = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: prep.listingId });
  assert.ok(!forged.ok && forged.code === "LISTING_INVALID", "signed by someone other than the seller");
  assert.equal(h.chain.builtSales.length, 0);
});

test("a stale listing (the seller moved the NFT or took the approval back) is closed instead of sold", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const { rec, asset } = await publishedNft(h, creator);
  const l1 = await listIt(h, creator, rec);

  h.chain.assets.get(asset)!.delegate = null; // approval revoked on-chain
  const r1 = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l1.listingId });
  assert.ok(!r1.ok && r1.code === "NOT_FOR_SALE");
  assert.equal((await getListing(l1.listingId))?.status, "CANCELLED");
  assert.equal((await getGate(asset)).state, "none", "the slot is free again");
  assert.equal((await marketStats(rec.themeId, clock)).listed, 0);

  const l2 = await listIt(h, creator, rec);
  h.chain.assets.get(asset)!.owner = b58(person()); // moved to another wallet
  const r2 = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l2.listingId });
  assert.ok(!r2.ok && r2.code === "NOT_FOR_SALE");
  assert.equal(h.chain.builtSales.length, 0);
});

test("buy rules: not your own NFT, not an expired or unknown listing, not a cancelled one", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const { rec } = await publishedNft(h, creator);
  const l = await listIt(h, creator, rec);

  const own = await prepareBuy(h.deps, { buyer: b58(creator), listingId: l.listingId });
  assert.ok(!own.ok && own.code === "OWN_LISTING");
  assert.equal((await prepareBuy(h.deps, { buyer: b58(buyer), listingId: "nope-nope-nope" })).ok, false);

  const cancel = await cancelListing(h.deps, { wallet: b58(person()), listingId: l.listingId });
  assert.ok(!cancel.ok && cancel.code === "NOT_FOUND", "only the seller can cancel");
  const cancelled = await cancelListing(h.deps, { wallet: b58(creator), listingId: l.listingId });
  assert.ok(cancelled.ok && cancelled.transactionBase64, "cancelling returns the transaction that takes the approval back");
  const afterCancel = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l.listingId });
  assert.ok(!afterCancel.ok && afterCancel.code === "NOT_FOR_SALE");
  assert.ok(!(await cancelListing(h.deps, { wallet: b58(creator), listingId: l.listingId })).ok, "can't cancel twice");

  const l2 = await listIt(h, creator, rec);
  clock += 49 * H;
  const expired = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l2.listingId });
  assert.ok(!expired.ok && expired.code === "EXPIRED");
  assert.equal((await marketStats(rec.themeId, clock)).listed, 0, "an expired listing isn't shown as for sale");
  clock -= 49 * H;
});

test("a cancelled NFT can be listed again", async () => {
  const h = harness();
  const creator = person();
  const { rec, asset } = await publishedNft(h, creator);
  const l = await listIt(h, creator, rec);
  assert.ok((await cancelListing(h.deps, { wallet: b58(creator), listingId: l.listingId })).ok);
  h.chain.assets.get(asset)!.delegate = null;
  assert.ok((await listIt(h, creator, rec, 4 * SOL)).kind === "primary");
});

test("SALES CAN'T BE FAKED: a transaction that isn't this purchase is refused, one transaction is one sale, and volume only counts verified sales", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const accomplice = person();
  const { rec, asset } = await publishedNft(h, creator);
  const l = await listIt(h, creator, rec, 2 * SOL);

  const b1 = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l.listingId });
  const b2 = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l.listingId });
  assert.ok(b1.ok && b2.ok);
  if (!b1.ok || !b2.ok) return;

  // The seller quietly transfers the NFT to the "buyer" with no payment: the buyer submits some unrelated transaction.
  const unrelated = fakeSig();
  h.chain.landed.set(unrelated, { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: b58(buyer), signer: true }], instructions: [] } } });
  const bad = await confirmSale(h.deps, { buyer: b58(buyer), saleId: b1.saleId, signature: unrelated });
  assert.ok(!bad.ok && bad.code === "MISMATCH");
  assert.equal((await marketStats(rec.themeId, clock)).sales, 0, "no fake volume");

  // A failed transaction is not a sale either.
  const failedSig = fakeSig();
  h.chain.landed.set(failedSig, toParsed(h.chain.builtSales[0].base64, { InstructionError: [0, "Custom"] }));
  assert.ok(!(await confirmSale(h.deps, { buyer: b58(buyer), saleId: b1.saleId, signature: failedSig })).ok);

  // Someone else can't complete the buyer's purchase.
  const other = await confirmSale(h.deps, { buyer: b58(accomplice), saleId: b1.saleId });
  assert.ok(!other.ok && other.code === "NOT_FOUND");

  // The real transaction lands. Recovery without a signature (closed tab): found among the NFT's recent transactions.
  const real = h.chain.land(h.chain.builtSales[0].base64, asset, b58(buyer));
  const done = await confirmSale(h.deps, { buyer: b58(buyer), saleId: b1.saleId });
  assert.ok(done.ok && !done.alreadyCompleted, JSON.stringify(done));
  assert.equal(done.ok && done.sale.signature, real);

  // The SAME transaction can't be claimed by the second purchase intent.
  const reuse = await confirmSale(h.deps, { buyer: b58(buyer), saleId: b2.saleId, signature: real });
  assert.ok(!reuse.ok && reuse.code === "SIGNATURE_USED", JSON.stringify(reuse));
  const stats = await marketStats(rec.themeId, clock);
  assert.deepEqual({ sales: stats.sales, volume: stats.volumeLamports }, { sales: 1, volume: 2 * SOL });
  assert.equal((await getGate(asset)).salesCount, 1, "the NFT's history counts one sale");
});

test("confirming with a malformed signature is refused", async () => {
  const h = harness();
  const creator = person();
  const buyer = person();
  const { rec } = await publishedNft(h, creator);
  const l = await listIt(h, creator, rec);
  const b = await prepareBuy(h.deps, { buyer: b58(buyer), listingId: l.listingId });
  assert.ok(b.ok);
  if (!b.ok) return;
  for (const bad of ["", "short", 5, "!".repeat(88)]) {
    const r = await confirmSale(h.deps, { buyer: b58(buyer), saleId: b.saleId, signature: bad });
    assert.ok(!r.ok && r.code === "BAD_SIGNATURE", String(bad));
  }
});

test("if building the transaction fails, nothing is left half-done", async () => {
  const creator = person();
  const h = harness({
    buildListTx: async () => {
      throw new Error("rpc down");
    },
  });
  const { rec, asset } = await publishedNft(h, creator);
  const r = await prepareListing(h.deps, { wallet: b58(creator), contentId: rec.contentId, priceLamports: SOL, expiresAt: clock + 24 * H });
  assert.ok(!r.ok && r.code === "ERROR");
  assert.equal((await getGate(asset)).state, "none", "the slot was released");
  assert.equal(h.alerts.length, 1);
});
