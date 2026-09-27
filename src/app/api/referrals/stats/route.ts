import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgReferralStats } from "@/lib/db/referrals";
import { campaignWindow, daysLeft } from "@/lib/referrals/constants";
import { solPriceUsd } from "@/lib/solana/prices";
import { eurUsdRate } from "@/lib/strategy/market";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: a wallet's affiliate stats (how many it referred, how much PANDA has verified was paid to
 *  it on-chain) plus the campaign's own window, so the Affiliates page can show a live "days left" countdown. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The affiliate campaign isn't on." }, { status: 404 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-stats:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const window = campaignWindow();
    const readStats = async () => {
      try {
        return await pgReferralStats(getDb(), wallet);
      } catch (err) {
        if (err instanceof DbNotConfiguredError) return { referredCount: 0, earnedLamports: 0 };
        throw err;
      }
    };
    const [stats, solUsd, eurUsd] = await Promise.all([readStats(), solPriceUsd().catch(() => 0), eurUsdRate()]);
    return NextResponse.json(
      { ...stats, solUsd: solUsd > 0 ? solUsd : null, eurUsd, campaign: window, daysLeft: daysLeft() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't read affiliate stats." }, { status: 500 });
  }
}
