import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { failure, marketGate, serverError } from "@/lib/market/route-helpers";
import { prepareListing } from "@/lib/market/service";

export const maxDuration = 30;

/**
 * Auth: signed-in wallet session; only the NFT's on-chain owner can list it.
 * Body: { contentId, priceLamports (integer), expiresAt (ms) }.
 * Output: the terms message for the seller to SIGN (free), and the transaction that approves PANDA's
 * market to transfer this one NFT (the NFT stays in the seller's wallet). Gated by NFT_MARKET (and
 * NFT_SECONDARY for anything that isn't the creator's first sale) and the `nft_market` pause switch.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  const gate = await marketGate(req, { name: "list", blockedWhenPaused: true, perMinute: 20 });
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await prepareListing(gate.deps, {
      wallet: gate.wallet,
      contentId: String(gate.body.contentId ?? ""),
      priceLamports: gate.body.priceLamports,
      expiresAt: gate.body.expiresAt,
    });
    if (!r.ok) return failure(r);
    return NextResponse.json({
      listingId: r.listingId,
      message: r.message,
      transaction: r.transactionBase64,
      lastValidBlockHeight: r.lastValidBlockHeight,
      kind: r.kind,
      preview: { price: r.preview.price, fee: r.preview.feeLamports, royalty: r.preview.royaltyLamports, youReceive: r.preview.sellerLamports },
    });
  } catch (err) {
    return serverError("list/prepare", err);
  }
}
