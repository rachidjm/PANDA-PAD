import { NextResponse } from "next/server";
import { failure, marketGate, serverError } from "@/lib/market/route-helpers";
import { confirmListing } from "@/lib/market/service";

export const maxDuration = 30;

/**
 * Auth: signed-in wallet session (the seller).
 * Body: { listingId, messageSignature (base58) } — the seller's signature over the exact terms.
 * Activates the listing only once that signature verifies AND the on-chain approval has landed.
 * 202 = approval not visible yet (safe to call again). Not blocked by the pause: finishing what was started is always allowed.
 */
export async function POST(req: Request) {
  const gate = await marketGate(req, { name: "list-confirm", blockedWhenPaused: false, perMinute: 40 });
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await confirmListing(gate.deps, { wallet: gate.wallet, listingId: String(gate.body.listingId ?? ""), messageSignature: gate.body.messageSignature });
    if (!r.ok) return failure(r);
    return NextResponse.json({ status: "ACTIVE", listingId: r.listing.listingId, priceLamports: r.listing.priceLamports, expiresAt: r.listing.expiresAt, alreadyActive: r.alreadyActive });
  } catch (err) {
    return serverError("list/confirm", err);
  }
}
