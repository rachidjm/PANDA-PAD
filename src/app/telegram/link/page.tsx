import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import TelegramLinkClient from "@/components/telegram/TelegramLinkClient";

export const metadata: Metadata = { title: "Link Telegram — PANDA", robots: { index: false, follow: false } };

/** Opened from the bot's /link button. Off with the flag (404). */
export default function TelegramLinkPage() {
  if (!isEnabled("TELEGRAM_BOT")) notFound();
  return (
    <div className="mx-auto max-w-md px-4 py-10 sm:px-5 sm:py-14">
      <Suspense>
        <TelegramLinkClient />
      </Suspense>
    </div>
  );
}
