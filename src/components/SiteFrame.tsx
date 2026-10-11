"use client";

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProtocolBanner from "@/components/ProtocolBanner";
import WalletProvider from "@/components/providers/WalletProvider";
import MobileTabBar from "@/components/MobileTabBar";
import SkipLink from "@/components/SkipLink";
import ReferralCapture from "@/components/ReferralCapture";
import ReferralAutoBind from "@/components/ReferralAutoBind";
import ReferralWelcomeBanner from "@/components/ReferralWelcomeBanner";
import { AIAssistantProvider } from "@/components/ai/AIAssistantProvider";
import { DrawTradeAIBridgeProvider } from "@/components/ai/DrawTradeAIBridge";
import AIAssistantModal from "@/components/ai/AIAssistantModal";
import AIAssistantFab from "@/components/ai/AIAssistantFab";

/**
 * The website's own frame around every page: the wallet, the assistant, the header, the footer and the phone's bar.
 * It is one module on purpose (see AppFrame): the Telegram Mini App has a frame of its own and never downloads this one.
 */
export default function SiteFrame({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <DrawTradeAIBridgeProvider>
        <AIAssistantProvider>
          <ReferralCapture />
          <ReferralAutoBind />
          <ReferralWelcomeBanner />
          <SkipLink />
          <Navbar />
          <ProtocolBanner />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <Footer />
          <MobileTabBar />
          <AIAssistantFab />
          <AIAssistantModal />
        </AIAssistantProvider>
      </DrawTradeAIBridgeProvider>
    </WalletProvider>
  );
}
