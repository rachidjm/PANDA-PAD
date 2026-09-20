import { NextResponse } from "next/server";
import { failure, marketGate, serverError } from "@/lib/market/route-helpers";
import { confirmSale } from "@/lib/market/service";

export const maxDuration = 30;

/**
 * Auth: signed-in wallet session; the purchase must be this wallet's.
 * Body: { saleId, signature? }. A sale is recorded ONLY after the landed transaction is fetched and
 * verified to be exactly the specified payments plus the NFT transfer — nothing the client says is
 * trusted. Without a signature (closed tab) the NFT's latest transactions are checked instead.
 * 202 = not confirmed yet (safe to repeat). Not blocked by the pause.
 */
export async function POST(req: Request) {
  const gate = await marketGate(req, { name: "buy-confirm", blockedWhenPaused: false, perMinute: 40 });
  if (gate instanceof NextResponse) return gate;
  try {
    const r = await confirmSale(gate.deps, { buyer: gate.wallet, saleId: String(gate.body.saleId ?? ""), signature: gate.body.signature });
    if (!r.ok) return failure(r);
    return NextResponse.json({
      status: "COMPLETED",
      asset: r.sale.assetAddress,
      signature: r.sale.signature ?? null,
      priceLamports: r.sale.priceLamports,
      kind: r.sale.kind,
      alreadyCompleted: r.alreadyCompleted,
    });
  } catch (err) {
    return serverError("buy/confirm", err);
  }
}
