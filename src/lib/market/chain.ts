import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { createNoopSigner, publicKey, signerIdentity, TransactionBuilder } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  addPlugin,
  getTransferV1InstructionDataSerializer,
  MPL_CORE_PROGRAM_ID,
  mplCore,
  fetchAsset,
  removePlugin,
  transfer,
} from "@metaplex-foundation/mpl-core";
import type { AssetLike } from "@/lib/nft/mint";
import type { Transfer } from "./split";

/**
 * The Solana side of the marketplace. Nothing here decides anything about
 * WHO may sell or WHAT the price is — that's the service's job — it builds
 * transactions and checks what actually landed on-chain.
 *
 * How a sale works with no custom program: the seller has approved PANDA's
 * market authority as the NFT's TransferDelegate (their listing). A sale is ONE
 * transaction in which the BUYER (fee payer) pays the seller, the creator's
 * royalty and PANDA's fee, and the market authority signs the NFT transfer to
 * the buyer. The market authority's signature covers the whole message, so the
 * payments can't be dropped or changed afterwards; and it holds no funds (the
 * buyer pays the fees), so it is only ever a signing key.
 */

type Blockhash = { blockhash: string; lastValidBlockHeight: number };
export type BuiltTx = { transactionBase64: string; blockhash: string; lastValidBlockHeight: number };

const umiFor = (rpcUrl: string, identity: string) => createUmi(rpcUrl).use(mplCore()).use(signerIdentity(createNoopSigner(publicKey(identity))));

/** Umi instructions -> web3.js instructions (Umi public keys are base58 strings). */
function toWeb3Instructions(builder: TransactionBuilder): TransactionInstruction[] {
  return builder.getInstructions().map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data),
      })
  );
}

async function blockhashFor(rpcUrl: string, injected?: Blockhash): Promise<Blockhash> {
  if (injected) return injected;
  const bh = await createUmi(rpcUrl).rpc.getLatestBlockhash();
  return { blockhash: bh.blockhash, lastValidBlockHeight: Number(bh.lastValidBlockHeight) };
}

function finish(tx: Transaction, bh: Blockhash, feePayer: string, sign?: Keypair): BuiltTx {
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = bh.blockhash;
  if (sign) tx.partialSign(sign);
  return {
    transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
  };
}

/** Seller-signed: approve PANDA's market authority to transfer this one NFT (the listing). The NFT stays in the seller's wallet. */
export async function buildListTransaction(args: { rpcUrl: string; seller: string; asset: string; marketAuthority: string; blockhash?: Blockhash }): Promise<BuiltTx> {
  const umi = umiFor(args.rpcUrl, args.seller);
  const builder = addPlugin(umi, {
    asset: { publicKey: publicKey(args.asset) } as never,
    plugin: { type: "TransferDelegate", authority: { type: "Address", address: publicKey(args.marketAuthority) } },
  });
  const tx = new Transaction().add(...toWeb3Instructions(builder));
  return finish(tx, await blockhashFor(args.rpcUrl, args.blockhash), args.seller);
}

/** Seller-signed: take the approval back (removes the TransferDelegate). */
export async function buildCancelTransaction(args: { rpcUrl: string; seller: string; asset: string; blockhash?: Blockhash }): Promise<BuiltTx> {
  const umi = umiFor(args.rpcUrl, args.seller);
  const builder = removePlugin(umi, { asset: { publicKey: publicKey(args.asset) } as never, plugin: { type: "TransferDelegate" } });
  const tx = new Transaction().add(...toWeb3Instructions(builder));
  return finish(tx, await blockhashFor(args.rpcUrl, args.blockhash), args.seller);
}

/**
 * Buyer-signed (fee payer), pre-signed by the market authority: the payments, then the NFT transfer.
 * `payments` must be exactly `saleTransfers(...)` — the verifier checks the landed transaction against the same list.
 */
export async function buildSaleTransaction(args: {
  rpcUrl: string;
  market: Keypair;
  buyer: string;
  asset: string;
  payments: Transfer[];
  blockhash?: Blockhash;
}): Promise<BuiltTx> {
  const { rpcUrl, market, buyer, asset, payments } = args;
  const umi = umiFor(rpcUrl, buyer);
  const builder = transfer(umi, {
    asset: { publicKey: publicKey(asset) } as never,
    newOwner: publicKey(buyer),
    authority: createNoopSigner(publicKey(market.publicKey.toBase58())),
  });
  const tx = new Transaction();
  for (const p of payments) {
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(p.from), toPubkey: new PublicKey(p.to), lamports: p.lamports }));
  }
  tx.add(...toWeb3Instructions(builder));
  return finish(tx, await blockhashFor(rpcUrl, args.blockhash), buyer, market);
}

/** The asset as it is on-chain right now, or null if it doesn't exist. */
export async function fetchAssetLike(rpcUrl: string, address: string): Promise<AssetLike | null> {
  const umi = createUmi(rpcUrl).use(mplCore());
  try {
    return (await fetchAsset(umi, publicKey(address), { commitment: "confirmed" })) as unknown as AssetLike;
  } catch (err) {
    // Only "the account doesn't exist" means null; an RPC failure must not look like a missing asset.
    if (err instanceof Error && err.name === "AccountNotFoundError") return null;
    throw err;
  }
}

// ---- verifying a sale that landed ---------------------------------------------------

/** The subset of `getParsedTransaction` (jsonParsed) output this check reads. */
export type ParsedTxLike = {
  meta: { err: unknown } | null;
  transaction: {
    message: {
      accountKeys: { pubkey: { toString(): string }; signer: boolean }[];
      instructions: ({
        programId: { toString(): string };
        program?: string;
        parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
        accounts?: { toString(): string }[];
        data?: string;
      })[];
    };
  };
};

const TRANSFER_DISCRIMINATOR = getTransferV1InstructionDataSerializer().serialize({})[0];

/**
 * Null when the transaction is EXACTLY a sale as specified — nothing more, nothing less:
 * succeeded; signed by exactly the buyer and the market authority; its SOL payments are
 * exactly `payments` (no extras, none missing, no altered amounts or recipients); and
 * its only other instruction is one Core TransferV1 of this asset to the buyer.
 */
export function verifySaleTx(
  tx: ParsedTxLike,
  expected: { buyer: string; marketAuthority: string; asset: string; payments: Transfer[] }
): string | null {
  if (!tx.meta) return "transaction has no result yet";
  if (tx.meta.err) return "transaction failed";

  const keys = tx.transaction.message.accountKeys;
  const signers = keys.filter((k) => k.signer).map((k) => String(k.pubkey));
  if (signers.length !== 2 || !signers.includes(expected.buyer) || !signers.includes(expected.marketAuthority)) return "unexpected signers";
  if (String(keys[0].pubkey) !== expected.buyer) return "the buyer must be the fee payer";

  const paid: Transfer[] = [];
  const core: ParsedTxLike["transaction"]["message"]["instructions"] = [];
  for (const ix of tx.transaction.message.instructions) {
    if (ix.program === "system" && ix.parsed?.type === "transfer") {
      const i = ix.parsed.info;
      if (!i || typeof i.source !== "string" || typeof i.destination !== "string" || !Number.isSafeInteger(i.lamports)) return "malformed payment";
      paid.push({ from: i.source, to: i.destination, lamports: i.lamports as number });
    } else if (String(ix.programId) === MPL_CORE_PROGRAM_ID) {
      core.push(ix);
    } else {
      return "unexpected instruction";
    }
  }

  const canon = (t: Transfer[]) => t.map((x) => `${x.from}>${x.to}:${x.lamports}`).sort().join("|");
  if (canon(paid) !== canon(expected.payments)) return "payments differ from the sale terms";

  if (core.length !== 1) return "expected exactly one NFT transfer";
  const accounts = (core[0].accounts ?? []).map(String);
  if (!accounts.includes(expected.asset) || !accounts.includes(expected.buyer) || !accounts.includes(expected.marketAuthority)) return "transfer doesn't involve the expected accounts";
  let data: Uint8Array;
  try {
    data = bs58.decode(core[0].data ?? "");
  } catch {
    return "malformed transfer";
  }
  if (data[0] !== TRANSFER_DISCRIMINATOR) return "not a transfer instruction";
  return null;
}
