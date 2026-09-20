import { randomUUID } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { filePutOnce } from "@/lib/storage/store";
import { getThemeBySlug } from "@/lib/themes/store";
import { alertOps } from "@/lib/alerts";
import { buildMintTransaction, verifyMintedAsset } from "./mint";
import type { NftDeps } from "./service";

/** The production wiring of the NFT service: real storage, real RPC, real alerts. */
export function realNftDeps(siteUrl: string): NftDeps {
  return {
    now: () => Date.now(),
    newId: () => randomUUID(),
    getTheme: getThemeBySlug,
    putFile: filePutOnce,
    buildTx: ({ wallet, expected }) => buildMintTransaction({ rpcUrl: serverRpcUrl(), wallet, expected }),
    signatureStatus: async (signature) => {
      const connection = new Connection(serverRpcUrl(), "confirmed");
      const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const s = value[0];
      if (!s) return "pending";
      if (s.err) return "failed";
      return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending";
    },
    verifyOnChain: (expected) => verifyMintedAsset(serverRpcUrl(), expected),
    siteUrl,
    alert: alertOps,
  };
}

/** The public origin of this deployment, for metadata links: an explicit env var wins, otherwise the request's own host. */
export function siteUrlFor(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers.get("host") ?? "localhost";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}
