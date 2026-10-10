import { publicBotUsername } from "@/lib/telegram/public";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProtocolBanner from "@/components/ProtocolBanner";
import WalletProvider from "@/components/providers/WalletProvider";
import MotionProvider from "@/components/providers/MotionProvider";
import { FeaturesProvider } from "@/components/providers/FeaturesProvider";
import MobileTabBar from "@/components/MobileTabBar";
import SkipLink from "@/components/SkipLink";
import ReferralCapture from "@/components/ReferralCapture";
import ReferralAutoBind from "@/components/ReferralAutoBind";
import ReferralWelcomeBanner from "@/components/ReferralWelcomeBanner";
import { AIAssistantProvider } from "@/components/ai/AIAssistantProvider";
import { DrawTradeAIBridgeProvider } from "@/components/ai/DrawTradeAIBridge";
import AIAssistantModal from "@/components/ai/AIAssistantModal";
import AIAssistantFab from "@/components/ai/AIAssistantFab";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { isEnabled } from "@/lib/config/flags";
import { connection } from "next/server";
import { cspMode } from "@/lib/security/csp";
import { siteUrl } from "@/lib/config/site";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const TITLE = "PANDA — The Solana Coin Launchpad";
const DESCRIPTION = "Create and trade coins on Solana — GIFs, memes, or your own idea, all in one place.";

export const metadata: Metadata = {
  // Lets every page's relative OG image / canonical URL resolve against the real domain — a page that sets
  // its own `openGraph`/`alternates` (e.g. /recruiters) only needs to give a path, never the full origin.
  metadataBase: new URL(siteUrl()),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: "PANDA", type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A nonce only exists per request, so with a CSP on every page is rendered per request (not prerendered at build).
  if (cspMode() !== "off") await connection();
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-16 sm:pb-0">
        <LanguageProvider>
          <MotionProvider>
            <FeaturesProvider
              features={{
                themes: isEnabled("NFT_THEMES"),
                branches: isEnabled("NFT_THEMES") && isEnabled("NFT_BRANCHES"),
                market: isEnabled("NFT_THEMES") && isEnabled("NFT_MARKET"),
                points: isEnabled("PANDA_POINTS"),
                airdrops: isEnabled("PANDA_AIRDROPS"),
                claims: isEnabled("PANDA_AIRDROPS") && isEnabled("MERKLE_CLAIMS"),
                strategies: isEnabled("STRATEGIES"),
                otcRewards: isEnabled("OTC_REWARDS"),
                holderRewards: isEnabled("HOLDER_REWARDS"),
                referrals: isEnabled("REFERRALS"),
                founderNft: isEnabled("FOUNDER_NFT"),
                aiAssistant: isEnabled("AI_ASSISTANT"),
                pandaOrders: isEnabled("PANDA_ORDERS"),
                telegramBot: publicBotUsername(),
              }}
            >
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
            </FeaturesProvider>
          </MotionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
