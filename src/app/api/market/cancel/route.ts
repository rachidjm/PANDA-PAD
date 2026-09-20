import { NextResponse } from "next/server";
import { failure, marketGate, serverError } from "@/lib/market/route-helpers";
import { cancelListing } from "@/lib/market/service";

export const maxDuration = 30;

/**
 * Auth: signed-in wallet session (the seller). Body: { listingId }.
 * Stops the listing immediately (PANDA will sign no more sales for it) and returns the transaction
 * that takes the on-chain approval back. Never blocked by the pause: a seller can always take a listing down.
 * Note: a purchase whose transaction was already built and signed by the buyer within the last
 * couple of minutes can still land; it is verified and recorded like any other sale.
 */
export async function POST(req: Request) {
  const gate = await marketGate(req, { name: "cancel", blockedWhenPaused: false, perMinute: 30 });
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await cancelListing(gate.deps, { wallet: gate.wallet, listingId: String(gate.body.listingId ?? "") });
    if (!r.ok) return failure(r);
    return NextResponse.json({ status: "CANCELLED", transaction: r.transactionBase64, lastValidBlockHeight: r.lastValidBlockHeight });
  } catch (err) {
    return serverError("cancel", err);
  }
}
