import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TgWalletReturn from "@/components/tg/TgWalletReturn";
import { getDb } from "@/lib/db/client";
import { rateLimited } from "@/lib/rate-limit";
import { leaveRelayAnswer, miniappEnabled } from "@/lib/telegram/miniapp";
import { parseReturnPath } from "@/lib/wallet/deeplink/protocol";

export const metadata: Metadata = { title: "PANDA", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where the wallet app comes back to after the user approves (or refuses) a request made from the Telegram Mini App:
 * /telegram/wallet/<wallet>/<slot>. A wallet can only answer by opening a web address with its answer attached, so this
 * address has to exist. The server keeps the wallet's ENCRYPTED answer in its relay slot right here, while building the
 * page — so by the time the page is on screen there is nothing left to do but go back to the Telegram app, which the
 * page does by itself (and offers as a button). It never opens the Mini App again: that one is still open in Telegram,
 * and it is the one that collects the answer and carries on where it was.
 */
export default async function TelegramWalletReturnPage({ params, searchParams }: PageProps<"/telegram/wallet/[[...slug]]">) {
  if (!miniappEnabled()) notFound();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const where = parseReturnPath(`/telegram/wallet/${(slug ?? []).join("/")}`);
  const answer: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (typeof v === "string") answer[k] = v;
  let stored: "done" | "rejected" | null = null;
  if (where && ((answer.nonce && answer.data) || answer.errorCode)) {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!(await rateLimited(`tg-relay:ip:${ip}`, 30, 60_000))) {
      // If the server can't keep it right now, the page below delivers it itself: this page never fails to open.
      const left = await Promise.resolve()
        .then(() => leaveRelayAnswer(getDb(), where.relayId, answer))
        .catch(() => "invalid" as const);
      // "gone": this address was opened twice — the answer is already there.
      if (left === "ok" || left === "gone") stored = answer.errorCode ? "rejected" : "done";
    }
  }
  return <TgWalletReturn stored={stored} />;
}
