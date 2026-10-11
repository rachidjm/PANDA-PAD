"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { isTgPath } from "@/components/tg/OutsideTg";

// Rendered on the server like any other component (the page's HTML is the same as ever) and downloaded with the page.
// It is a separate file only so that the Telegram Mini App, which never shows it, never downloads it either.
const SiteFrame = dynamic(() => import("./SiteFrame"));

/**
 * Which frame a page gets. The website: its header, footer, bars, wallet and assistant (SiteFrame). The Telegram Mini
 * App (/tg): nothing here — its own shell (src/components/tg/TgShell.tsx) brings its frame, and loads the wallet code
 * after its first screen is already on the phone.
 */
export default function AppFrame({ children }: { children: React.ReactNode }) {
  if (isTgPath(usePathname())) {
    return (
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
    );
  }
  return <SiteFrame>{children}</SiteFrame>;
}
