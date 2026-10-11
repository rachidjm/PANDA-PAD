import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import TgShell from "@/components/tg/TgShell";
import { miniappEnabled } from "@/lib/telegram/miniapp";
import { publicBotUsername } from "@/lib/telegram/public";

export const metadata: Metadata = { title: "PANDA", robots: { index: false, follow: false } };

/** The page reaches the phone's edges (so the bars can be drawn to them) and reports its notch and home bar: env(safe-area-inset-*). */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

/** The Telegram Mini App (docs/TELEGRAM.md, section 12). With FEATURE_TELEGRAM_MINIAPP off, none of /tg exists. */
export default function TgLayout({ children }: LayoutProps<"/tg">) {
  if (!miniappEnabled()) notFound();
  return <TgShell botUsername={publicBotUsername()}>{children}</TgShell>;
}
