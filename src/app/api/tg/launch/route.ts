import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { walletKey } from "@/lib/telegram/link";
import { appGate, noStore } from "@/lib/telegram/miniapp-route";

/**
 * ?mint=<address>: the signature of the transaction that created that coin, or null when it isn't on the chain.
 * Read-only (public chain data). The Mini App asks it when Telegram restarted it while a coin was being created
 * (src/components/tg/launch.ts); recording the launch is then done by the same route the website uses, which checks
 * the transaction itself.
 */
export async function GET(req: Request) {
  const g = await appGate(req, 20, "launch");
  if (g instanceof NextResponse) return g;
  const mint = walletKey(new URL(req.url).searchParams.get("mint"));
  if (!mint) return NextResponse.json({ error: "invalid", code: "invalid" }, { status: 400 });
  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const found = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: 50 });
    // The oldest transaction that touched the address and succeeded is the one that created it.
    const first = [...found].reverse().find((s) => !s.err);
    return NextResponse.json({ signature: first?.signature ?? null }, noStore);
  } catch {
    return NextResponse.json({ error: "unavailable", code: "unavailable" }, { status: 503 });
  }
}
