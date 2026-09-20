import { Connection, PublicKey } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { blobConfigured } from "@/lib/rewards/blob-store";
import { PANDA_TREASURY, PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { parseAdminWallets } from "@/lib/auth/admin-policy";
import { POINTS_CONFIG } from "@/lib/points/config";
import { getEpochs, listWalletDocs } from "@/lib/points/store";
import { getTrades } from "@/lib/portfolio/trade-log";
import { listThemes } from "@/lib/themes/store";
import { listSales } from "@/lib/market/store";
import { getMarketSigner } from "@/lib/market/deps";
import { ChainHistory, lookupProfile } from "./profiles";
import type { AbuseDeps } from "./run";

/** The real chain access for wallet history (read-only RPC calls). */
export function realChainHistory(connection = new Connection(serverRpcUrl(), "confirmed")): ChainHistory {
  return {
    signatures: async (address, opts) => {
      const list = await connection.getSignaturesForAddress(new PublicKey(address), { before: opts.before, limit: opts.limit }, "confirmed");
      return list.map((s) => ({ signature: s.signature, blockTime: s.blockTime ?? null, failed: s.err !== null }));
    },
    solDeltas: async (signature) => {
      const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx?.meta) return null;
      return tx.transaction.message.accountKeys.map((k, i) => ({
        account: k.pubkey.toBase58(),
        delta: tx.meta!.postBalances[i] - tx.meta!.preBalances[i],
        signer: k.signer,
      }));
    },
  };
}

/** PANDA's own wallets (and admins): they move funds for everybody, so they are never analysed as users. */
export function exemptWallets(): Set<string> {
  const out = new Set<string>([PANDA_TREASURY.toBase58()]);
  if (PANDA_REWARDS_POOL) out.add(PANDA_REWARDS_POOL.toBase58());
  for (const a of parseAdminWallets(process.env.ADMIN_WALLETS)) out.add(a);
  try {
    const market = getMarketSigner();
    if (market) out.add(market.publicKey.toBase58());
  } catch {
    /* an invalid market key is reported where it is used */
  }
  return out;
}

export function realAbuseDeps(): AbuseDeps {
  const chain = realChainHistory();
  return {
    now: () => Date.now(),
    getEpoch: async (id) => (await getEpochs()).find((e) => e.id === id) ?? null,
    walletDocs: listWalletDocs,
    // Trade logs live in Blob; without a store (local dev) there is simply no data — the report's coverage shows it.
    trades: async (wallet) => (blobConfigured() ? getTrades(wallet) : []),
    completedSales: async () => {
      const themes = await listThemes();
      const all = await Promise.all(themes.map((t) => listSales(t.themeId)));
      return all.flat().filter((s) => s.status === "COMPLETED");
    },
    lookupProfile: (wallet) => lookupProfile(wallet, chain),
    exempt: exemptWallets,
    eventCap: POINTS_CONFIG.caps.maxEventsPerWallet,
  };
}
