import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TgShell from "@/components/tg/TgShell";
import { miniappEnabled } from "@/lib/telegram/miniapp";
import { publicBotUsername } from "@/lib/telegram/public";

export const metadata: Metadata = { title: "PANDA", robots: { index: false, follow: false } };

/** The Telegram Mini App (docs/TELEGRAM.md, section 12). With FEATURE_TELEGRAM_MINIAPP off, none of /tg exists. */
export default function TgLayout({ children }: LayoutProps<"/tg">) {
  if (!miniappEnabled()) notFound();
  return <TgShell botUsername={publicBotUsername()}>{children}</TgShell>;
}
