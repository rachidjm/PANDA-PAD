import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { PandaDefs } from "@/components/panda/Panda";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProtocolBanner from "@/components/ProtocolBanner";
import WalletProvider from "@/components/providers/WalletProvider";
import MotionProvider from "@/components/providers/MotionProvider";
import { FeaturesProvider } from "@/components/providers/FeaturesProvider";
import MobileTabBar from "@/components/MobileTabBar";
import SkipLink from "@/components/SkipLink";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { isEnabled } from "@/lib/config/flags";
import { connection } from "next/server";
import { cspMode } from "@/lib/security/csp";

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

export const metadata: Metadata = {
  title: "PANDA — The Solana Coin Launchpad",
  description: "Create and trade coins on Solana — GIFs, memes, or your own idea, all in one place.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // A nonce only exists per request, so with a CSP on every page is rendered per request (not prerendered at build).
  if (cspMode() !== "off") await connection();
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col pb-16 sm:pb-0">
        <PandaDefs />
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
              }}
            >
              <WalletProvider>
                <SkipLink />
                <Navbar />
                <ProtocolBanner />
                <main id="main" tabIndex={-1} className="flex-1 outline-none">
                  {children}
                </main>
                <Footer />
                <MobileTabBar />
              </WalletProvider>
            </FeaturesProvider>
          </MotionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
