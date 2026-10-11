"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";
import SessionKeeper from "./SessionKeeper";
import { isTgPath } from "@/components/tg/OutsideTg";
import { DeepLinkWalletAdapter } from "@/lib/wallet/deeplink/adapter";

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
  // Inside the Telegram Mini App (/tg) there is no extension to find: the wallets there are the user's own wallet APPS,
  // reached through their official deep links (src/lib/wallet/deeplink). Nowhere else are they offered.
  const tg = isTgPath(usePathname());
  const wallets = useMemo(() => (tg ? [new DeepLinkWalletAdapter("phantom"), new DeepLinkWalletAdapter("solflare")] : [new PhantomWalletAdapter()]), [tg]);
  const config = useMemo(() => ({ commitment: "confirmed" as const, confirmTransactionInitialTimeout: 60_000 }), []);

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <SolanaWalletProvider wallets={wallets} autoConnect localStorageKey={tg ? "panda.tg.walletName" : "walletName"}>
        {/* The Mini App has its own session, in memory (src/components/tg/session.ts): no cookie to keep there. */}
        {!tg && <SessionKeeper />}
        {children}
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
