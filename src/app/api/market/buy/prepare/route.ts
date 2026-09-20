import { NextResponse } from "next/server";
import { failure, marketGate, serverError } from "@/lib/market/route-helpers";
import { prepareBuy } from "@/lib/market/service";

export const maxDuration = 30;

/**
 * Auth: signed-in wallet session (the buyer).
 * Body: { listingId }. The price comes from the seller's SIGNED terms, never from the request.
 * Output: ONE transaction — the buyer pays the seller, the creator's royalty (secondary sales) and
 * PANDA's fee, and PANDA's market authority pre-signs the NFT transfer. The buyer's wallet signs
 * last and pays the network fee; the server can't spend the buyer's money. Also returns the exact
 * split so the UI can show it BEFORE the buyer signs. Gated by NFT_MARKET and the `nft_market` pause.
 */
export async function POST(req: Request) {
  const gate = await marketGate(req, { name: "buy", blockedWhenPaused: true, perMinute: 20 });
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await prepareBuy(gate.deps, { buyer: gate.wallet, listingId: String(gate.body.listingId ?? "") });
    if (!r.ok) return failure(r);
    return NextResponse.json({
      saleId: r.saleId,
      transaction: r.transactionBase64,
      lastValidBlockHeight: r.lastValidBlockHeight,
      name: r.name,
      kind: r.kind,
      split: { price: r.split.price, fee: r.split.feeLamports, royalty: r.split.royaltyLamports, seller: r.split.sellerLamports },
      payments: r.payments,
    });
  } catch (err) {
    return serverError("buy/prepare", err);
  }
}
