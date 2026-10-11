import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { buildConvertToSolTransaction } from "@/lib/jupiter/swap";

/**
 * Builds (never sends) the swap that turns a token of the wallet into SOL, for a Draw Your Trade buy order paid with a
 * coin that is neither SOL nor USDC. The wallet signs it together with the order's deposit; the browser sends it first.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
  const limited = await moneyRateGate(`trade-build:${clientIp(req)}`, 40, 60_000, () => NextResponse.json({ error: "Too many requests — wait a moment and try again." }, { status: 429 }));
  if (limited) return limited;
  try {
    const { user, payMint, lamports } = await req.json();
    if (typeof user !== "string" || typeof payMint !== "string" || typeof lamports !== "string" || !/^[1-9]\d{0,15}$/.test(lamports)) {
      return NextResponse.json({ error: "Missing user, payMint or lamports." }, { status: 400 });
    }
    let userKey: PublicKey;
    let mintKey: PublicKey;
    try {
      userKey = new PublicKey(user);
      mintKey = new PublicKey(payMint);
    } catch {
      return NextResponse.json({ error: "Invalid user or payMint." }, { status: 400 });
    }
    const built = await buildConvertToSolTransaction({ user: userKey, payMint: mintKey, lamports: BigInt(lamports) });
    return NextResponse.json({ transaction: Buffer.from(built.transaction.serialize()).toString("base64"), inAmount: built.inAmount, minOutLamports: built.minOutLamports });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to build the conversion.", code: "convert_failed" }, { status: 502 });
  }
}
