import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/config/flags";
import { getSessionWallet } from "@/lib/auth/session";
import { rateLimited } from "@/lib/rate-limit";
import { getEpochs, getTotals, getWalletDoc } from "@/lib/points/store";
import { walletTotal } from "@/lib/points/events";
import { getStanding } from "@/lib/abuse/store";
import { isPunitive } from "@/lib/abuse/policy";

/**
 * Auth: a signed-in wallet session — a wallet only ever sees its own points.
 * A wallet under RESTRICTED / DISQUALIFIED also gets `restriction` (status, reason codes, appeal state);
 * everyone else gets null — a routine REVIEW is never shown.
 * Output: the current epoch's running total broken down by type (provisional
 * until the epoch is finalized) plus the pinned totals of finalized epochs.
 * Gated by the PANDA_POINTS feature flag.
 */
export async function GET(req: Request) {
  if (!isEnabled("PANDA_POINTS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  if (await rateLimited(`points-me:${wallet}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const epochs = await getEpochs();
    const current = epochs.find((e) => e.status === "ACTIVE") ?? null;

    let currentPoints: { epoch: number; total: number; byType: Record<string, number>; events: number; provisional: true } | null = null;
    if (current) {
      const doc = await getWalletDoc(current.id, wallet);
      const byType: Record<string, number> = {};
      for (const e of doc.events) if (e.status === "valid") byType[e.type] = (byType[e.type] ?? 0) + e.points;
      currentPoints = { epoch: current.id, total: walletTotal(doc), byType, events: doc.events.length, provisional: true };
    }

    const finalized = await Promise.all(
      epochs
        .filter((e) => e.totalsHash)
        .slice(-5)
        .map(async (e) => {
          const totals = await getTotals(e.id);
          return { epoch: e.id, points: totals?.entries.find((x) => x.wallet === wallet)?.points ?? 0, verified: totals !== null && totals.hash === e.totalsHash };
        })
    );

    // A wallet is told about its standing only when it actually affects it (never for a quiet REVIEW).
    const standing = await getStanding(wallet);
    const last = standing.history[standing.history.length - 1];
    const restriction = isPunitive(standing.status)
      ? {
          status: standing.status,
          since: last?.at ?? null,
          reasonCodes: last?.reasonCodes ?? [],
          appeal: standing.appeals.length ? { status: standing.appeals[standing.appeals.length - 1].status } : null,
        }
      : null;

    const res = NextResponse.json({ wallet, current: currentPoints, finalized, restriction });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Couldn't load your points." }, { status: 500 });
  }
}
