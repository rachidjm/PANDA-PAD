import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgCountValidInvitees, pgFounderAllocation, pgFounderSlotsTaken, pgReferralStats } from "@/lib/db/referrals";
import { solPriceUsd } from "@/lib/solana/prices";
import { eurUsdRate } from "@/lib/strategy/market";
import { founderMinTraderVolumeUsd, founderRequiredTraders } from "@/lib/referrals/tiers-config";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Public, read-only: a wallet's recruiter stats (how many it referred, how much PANDA has verified was paid to
 *  it on-chain), plus its Founder allocation if it has one and how many of the 1,000 slots remain. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-stats:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const readDb = async <T>(fallback: T, read: (db: ReturnType<typeof getDb>) => Promise<T>) => {
      try {
        return await read(getDb());
      } catch (err) {
        if (err instanceof DbNotConfiguredError) return fallback;
        throw err;
      }
    };
    const [stats, founder, founderSlotsTaken, solUsd, eurUsd, validInviteeCount] = await Promise.all([
      readDb<{ referredCount: number; earnedLamports: number }>({ referredCount: 0, earnedLamports: 0 }, (db) => pgReferralStats(db, wallet)),
      readDb<Awaited<ReturnType<typeof pgFounderAllocation>>>(null, (db) => pgFounderAllocation(db, wallet)),
      readDb<number>(0, (db) => pgFounderSlotsTaken(db)),
      solPriceUsd().catch(() => 0),
      eurUsdRate(),
      // Only meaningful before becoming a Founder — the Recruiters page's "X/N traders válidos" progress line.
      readDb<number>(0, (db) => pgCountValidInvitees(db, wallet, founderMinTraderVolumeUsd())),
    ]);
    return NextResponse.json(
      {
        ...stats,
        solUsd: solUsd > 0 ? solUsd : null,
        eurUsd,
        founder,
        founderSlotsLeft: Math.max(0, 1000 - founderSlotsTaken),
        validInviteeCount,
        founderRequiredTraders: founderRequiredTraders(),
        founderMinTraderVolumeUsd: founderMinTraderVolumeUsd(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Couldn't read recruiter stats." }, { status: 500 });
  }
}
