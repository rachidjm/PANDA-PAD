"use client";

import { useEffect, useMemo } from "react";
import { ConnectionProvider, useWallet, WalletProvider as SolanaWalletProvider } from "@solana/wallet-adapter-react";
import type { Adapter, WalletName } from "@solana/wallet-adapter-base";
import ProtocolBanner from "@/components/ProtocolBanner";
import { AIAssistantProvider } from "@/components/ai/AIAssistantProvider";
import { DrawTradeAIBridgeProvider } from "@/components/ai/DrawTradeAIBridge";
import AIAssistantModal from "@/components/ai/AIAssistantModal";
import { DeepLinkWalletAdapter } from "@/lib/wallet/deeplink/adapter";

/**
 * The wallet side of the Mini App: the user's own wallet APPS, reached through their official deep links
 * (src/lib/wallet/deeplink), and around the screens the same providers the website's own panels expect — so the
 * website's trading panel, Draw Your Trade and the create form run here unchanged.
 *
 * It is the heavy part (Solana's libraries), so the shell downloads it AFTER its first screen is on the phone, and
 * every screen is rendered inside it.
 */

export type WalletKit = { wallets: { adapter: Adapter }[]; select: (name: WalletName | null) => void; disconnect: () => Promise<void> };

function Kit({ onKit }: { onKit: (kit: WalletKit | null) => void }) {
  const { wallets, select, disconnect } = useWallet();
  useEffect(() => {
    onKit({ wallets, select, disconnect });
  }, [wallets, select, disconnect, onKit]);
  useEffect(() => () => onKit(null), [onKit]);
  return null;
}

export default function TgWalletRoot({ children, onKit }: { children: React.ReactNode; onKit: (kit: WalletKit | null) => void }) {
  // Browsers can't call the public RPC: everything goes through PANDA's own /api/rpc proxy (as on the website).
  const endpoint = useMemo(() => `${window.location.origin}/api/rpc`, []);
  const wallets = useMemo(() => [new DeepLinkWalletAdapter("phantom"), new DeepLinkWalletAdapter("solflare")], []);
  const config = useMemo(() => ({ commitment: "confirmed" as const, confirmTransactionInitialTimeout: 60_000 }), []);
  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <SolanaWalletProvider wallets={wallets} autoConnect localStorageKey="panda.tg.walletName">
        <Kit onKit={onKit} />
        <DrawTradeAIBridgeProvider>
          <AIAssistantProvider>
            <ProtocolBanner />
            {children}
            <AIAssistantModal />
          </AIAssistantProvider>
        </DrawTradeAIBridgeProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
