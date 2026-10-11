import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TgWalletReturn from "@/components/tg/TgWalletReturn";
import { miniappEnabled } from "@/lib/telegram/miniapp";
import { publicBotUsername } from "@/lib/telegram/public";

export const metadata: Metadata = { title: "PANDA", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where the wallet app comes back to after the user approves (or refuses) a request made from the Telegram Mini App.
 * It opens in the phone's browser, hands the wallet's ENCRYPTED answer to the relay and sends the user back to Telegram.
 */
export default function TelegramWalletReturnPage() {
  if (!miniappEnabled()) notFound();
  return <TgWalletReturn botUsername={publicBotUsername()} />;
}
