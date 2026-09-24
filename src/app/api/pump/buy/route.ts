import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildBuyTransaction } from "@/lib/pump/buy";

export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  // Building a trade costs real RPC calls: cap it per visitor so nobody can burn the RPC budget everyone else trades with.
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`trade-build:${clientIp(req)}`, 40, 60_000, () => NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 }));
    if (limited) return limited;
  }
  try {
    const { mint, user, solAmount, poolAddress, slippagePct } = await req.json();
    if (!mint || !user || !solAmount) {
      return NextResponse.json({ error: "Missing mint, user or solAmount." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);

    const tx = await buildBuyTransaction({
      connection,
      mint: new PublicKey(mint),
      user: userKey,
      solAmount: Number(solAmount),
      poolAddress: poolAddress ? new PublicKey(poolAddress) : undefined,
      slippagePct: slippagePct ? Number(slippagePct) : undefined,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = userKey;
    tx.recentBlockhash = blockhash;

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return NextResponse.json({ transaction: serialized.toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
