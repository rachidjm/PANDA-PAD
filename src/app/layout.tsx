import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { PandaDefs } from "@/components/panda/Panda";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ProtocolBanner from "@/components/ProtocolBanner";
import WalletProvider from "@/components/providers/WalletProvider";
import MotionProvider from "@/components/providers/MotionProvider";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { isEnabled } from "@/lib/config/flags";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <PandaDefs />
        <LanguageProvider>
          <MotionProvider>
            <WalletProvider>
              <Navbar showThemes={isEnabled("NFT_THEMES")} />
              <ProtocolBanner />
              <main className="flex-1">{children}</main>
              <Footer />
            </WalletProvider>
          </MotionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
