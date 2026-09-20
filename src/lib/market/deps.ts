import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { verifyEd25519 } from "@/lib/auth/wallet-auth";
import { isEnabled } from "@/lib/config/flags";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { alertOps } from "@/lib/alerts";
import { randomUUID } from "node:crypto";
import { buildCancelTransaction, buildListTransaction, buildSaleTransaction, fetchAssetLike, ParsedTxLike } from "./chain";
import type { MarketDeps } from "./service";

/**
 * PANDA's market authority key: the only thing that can move a listed NFT, and
 * only for the buyer of a sale whose payments the buyer's own transaction makes.
 * It holds no funds (buyers pay the network fees), so it is purely a signing key.
 * Base58 or JSON byte array, in a server-only env var; unset = the market is off (fail closed).
 * Use a DEDICATED key — not the Treasury, the Rewards Pool or the Airdrop pool.
 */
export function getMarketSigner(): Keypair | null {
  const raw = process.env.PANDA_MARKET_AUTHORITY_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
  } catch {
    throw new Error("PANDA_MARKET_AUTHORITY_SECRET_KEY is set but isn't valid (expected base58 or a JSON byte array).");
  }
}

/** The production wiring, or null when the market authority isn't configured. */
export function realMarketDeps(req: Request): MarketDeps | null {
  const market = getMarketSigner();
  if (!market) return null;
  const rpcUrl = serverRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");

  return {
    now: () => Date.now(),
    newId: () => randomUUID(),
    marketAuthority: market.publicKey.toBase58(),
    treasury: PANDA_TREASURY.toBase58(),
    domain: req.headers.get("host") ?? "localhost",
    allowSecondary: isEnabled("NFT_SECONDARY"),
    fetchAsset: (asset) => fetchAssetLike(rpcUrl, asset),
    buildListTx: (seller, asset) => buildListTransaction({ rpcUrl, seller, asset, marketAuthority: market.publicKey.toBase58() }),
    buildCancelTx: (seller, asset) => buildCancelTransaction({ rpcUrl, seller, asset }),
    buildSaleTx: (buyer, asset, payments) => buildSaleTransaction({ rpcUrl, market, buyer, asset, payments }),
    getParsedTx: async (signature) => {
      const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      return (tx as unknown as ParsedTxLike) ?? null;
    },
    recentSignatures: async (asset, limit) => {
      const sigs = await connection.getSignaturesForAddress(new PublicKey(asset), { limit }, "confirmed");
      return sigs.filter((s) => !s.err).map((s) => s.signature);
    },
    verifySignature: (message, signatureBase58, wallet) => {
      try {
        return verifyEd25519(new TextEncoder().encode(message), bs58.decode(signatureBase58), new PublicKey(wallet).toBytes());
      } catch {
        return false;
      }
    },
    alert: alertOps,
  };
}
