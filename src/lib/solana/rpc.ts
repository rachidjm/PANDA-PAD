import { clusterApiUrl } from "@solana/web3.js";

/**
 * The RPC endpoint every SERVER-side call uses. `SOLANA_RPC_URL` is the
 * preferred place for a provider URL (Helius, QuickNode, ...) because it is a
 * server-only variable — the key never ships to the browser. The public
 * fallback works for a few light calls but rejects wallet-scanning queries
 * (403 "Access forbidden"), which is why Portfolio needs a real provider.
 */
export function serverRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");
}
