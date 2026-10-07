import { NextResponse } from "next/server";
import { getLedger, unclaimedLamports } from "@/lib/rewards/ledger";
import { PublicKey } from "@solana/web3.js";

/** Public, read-only: one holder's own rewards status for one mint (entitled/received/still-pending-send) —
 *  the portfolio and /rewards both read this. Never a trigger for anything: payouts are sent automatically by
 *  the collect-fees cron (src/lib/rewards/run-payout.ts), not by a holder visiting this page. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const mint = params.get("mint");
  const holder = params.get("holder");
  if (!mint || !holder) return NextResponse.json({ error: "Missing mint or holder." }, { status: 400 });
  try {
    new PublicKey(mint);
    new PublicKey(holder);
  } catch {
    return NextResponse.json({ error: "Invalid mint or holder." }, { status: 400 });
  }

  try {
    const ledger = await getLedger(mint);
    const entry = ledger.holders[holder] || { entitledLamports: 0, claimedLamports: 0 };
    return NextResponse.json({
      entitledLamports: entry.entitledLamports,
      claimedLamports: entry.claimedLamports,
      unclaimedLamports: unclaimedLamports(ledger, holder),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read rewards ledger.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Replaced by the automatic payout round the collect-fees cron runs for every registered mint (see
 * src/lib/rewards/run-payout.ts) — a holder no longer has anything to claim by hand, so this no longer does
 * anything. Kept as a route (rather than deleted) only so an old client still gets a clear, honest answer
 * instead of a generic 404. The reserve → send → confirm/release safety this used to drive directly is the
 * SAME machinery the automatic round drives instead (src/lib/rewards/ledger.ts) — nothing about how a payout
 * is made safe changed, only who triggers it.
 */
export async function POST() {
  return NextResponse.json({ error: "Holder rewards are sent automatically now — there's nothing to claim.", code: "AUTO_PAYOUT" }, { status: 410 });
}
