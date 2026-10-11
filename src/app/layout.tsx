import { publicBotUsername } from "@/lib/telegram/public";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import AppFrame from "@/components/AppFrame";
import MotionProvider from "@/components/providers/MotionProvider";
import { FeaturesProvider } from "@/components/providers/FeaturesProvider";
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
    // Inside Telegram, Telegram's own script writes its colours and safe areas onto <html> before the app starts: expected, not a mismatch.
    <html lang="en" className={`${bricolage.variable} ${inter.variable} h-full antialiased`} suppressHydrationWarning>
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
              <AppFrame>{children}</AppFrame>
            </FeaturesProvider>
          </MotionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
