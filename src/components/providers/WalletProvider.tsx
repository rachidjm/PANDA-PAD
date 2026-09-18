"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";

export default function WalletProvider({ children }: { children: React.ReactNode }) {
  // Pump.fun only exists on mainnet, so real trading needs a mainnet RPC.
  // The public endpoint is rate-limited; set NEXT_PUBLIC_SOLANA_RPC_URL to a
  // provider (Helius, QuickNode, Triton...) for reliable use in production.
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), []);
  // Solflare, Backpack, etc. are picked up automatically via the Wallet
  // Standard. Phantom also supports it, but we register its adapter
  // explicitly too: it's what lets the button deep-link into the Phantom
  // mobile app when no extension is installed, instead of just saying "install it".
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        {children}
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
