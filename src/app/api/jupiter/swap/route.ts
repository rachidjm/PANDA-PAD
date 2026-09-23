import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildJupiterSwapTransaction } from "@/lib/jupiter/swap";

export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  // Building a trade costs real RPC calls: cap it per visitor so nobody can burn the RPC budget everyone else trades with.
  if (rateLimited(`trade-build:${clientIp(req)}`, 40, 60_000)) return NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 });
  try {
    const { mint, user, side, solAmount, tokenAmount, payMint, payAmount, slippagePct } = await req.json();
    if (!mint || !user || (side !== "buy" && side !== "sell")) {
      return NextResponse.json({ error: "Missing mint, user or side." }, { status: 400 });
    }
    if (side === "buy" && payMint !== undefined) {
      // Paying with a token from the wallet: which token, and how much of it in base units (digits only).
      if (typeof payMint !== "string" || typeof payAmount !== "string" || !/^[1-9]\d{0,29}$/.test(payAmount)) {
        return NextResponse.json({ error: "Invalid payMint or payAmount." }, { status: 400 });
      }
      try {
        new PublicKey(payMint);
      } catch {
        return NextResponse.json({ error: "Invalid payMint." }, { status: 400 });
      }
    } else if (side === "buy" && !solAmount) {
      return NextResponse.json({ error: "Missing solAmount." }, { status: 400 });
    }
    if (side === "sell" && !tokenAmount) {
      return NextResponse.json({ error: "Missing tokenAmount." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");

    const tx = await buildJupiterSwapTransaction({
      connection,
      mint: new PublicKey(mint),
      user: new PublicKey(user),
      side,
      solAmount: solAmount ? Number(solAmount) : undefined,
      tokenAmount: tokenAmount ? String(tokenAmount) : undefined,
      payMint: side === "buy" && payMint ? new PublicKey(payMint) : undefined,
      payAmount: side === "buy" && payMint ? String(payAmount) : undefined,
      slippagePct: slippagePct ? Number(slippagePct) : undefined,
    });

    const serialized = tx.serialize();
    return NextResponse.json({ transaction: Buffer.from(serialized).toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
