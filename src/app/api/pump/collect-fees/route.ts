import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { buildCollectCreatorFeesTransaction } from "@/lib/pump/distribute";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { pausedResponse } from "@/lib/protocol/guard";

/**
 * Builds the real, unsigned `distributeCreatorFees` transaction for a coin — see
 * src/lib/pump/distribute.ts's buildCollectCreatorFeesTransaction. `user` pays the (tiny) network fee and
 * signs in their own wallet; PANDA never touches the money, which is paid straight to every configured
 * shareholder (including PANDA's own share and the creator's) atomically by the instruction itself.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  const paused = await pausedResponse("fee_processing"); // same subsystem switch the daily fee-collection cron already uses
  if (paused) return paused;
  {
    const limited = await moneyRateGate(`collect-fees:${clientIp(req)}`, 20, 60_000, () => NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 }));
    if (limited) return limited;
  }

  try {
    const { mint, user } = await req.json();
    if (typeof mint !== "string" || typeof user !== "string") return NextResponse.json({ error: "Missing mint or user." }, { status: 400 });

    let mintKey: PublicKey;
    let userKey: PublicKey;
    try {
      mintKey = new PublicKey(mint);
      userKey = new PublicKey(user);
    } catch {
      return NextResponse.json({ error: "Invalid mint or user address." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const tx = await buildCollectCreatorFeesTransaction(connection, mintKey.toBase58(), userKey);
    if (!tx) return NextResponse.json({ error: "Nothing real to collect for this coin right now." }, { status: 409 });

    return NextResponse.json({ transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build the collect transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
