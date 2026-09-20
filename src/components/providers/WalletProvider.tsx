"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";

export default function WalletProvider({ children }: { children: React.ReactNode }) {
  // Browsers can't call the public RPC at all (it answers every request that carries a
  // browser Origin with 403), so everything goes through PANDA's own /api/rpc proxy,
  // which calls the RPC from the server. Server-side URL is set via SOLANA_RPC_URL.
  const endpoint = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : clusterApiUrl("mainnet-beta")),
    []
  );
  // Solflare, Backpack, etc. are picked up automatically via the Wallet
  // Standard. Phantom also supports it, but we register its adapter
  // explicitly too: it's what lets the button deep-link into the Phantom
  // mobile app when no extension is installed, instead of just saying "install it".
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const config = useMemo(() => ({ commitment: "confirmed" as const, confirmTransactionInitialTimeout: 60_000 }), []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        {children}
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
