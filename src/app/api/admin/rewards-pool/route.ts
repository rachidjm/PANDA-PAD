import { NextResponse } from "next/server";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { requireAdmin } from "@/lib/auth/admin";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { rewardsPoolServerStatus } from "@/lib/pump/rewards-pool-signer";

/**
 * Auth: admin. What the server is ACTUALLY able to load for the Rewards Pool right now — its public key and
 * SOL balance only, never the secret — so an admin can confirm it's the dedicated server wallet they expect
 * (compare the address shown here against any wallet you'd recognize) rather than trusting the env var blindly.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const status = rewardsPoolServerStatus();
  if (!status.configured) return NextResponse.json({ configured: false });
  if (!status.ok) return NextResponse.json({ configured: true, ok: false, error: status.error });

  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const lamports = await connection.getBalance(new PublicKey(status.publicKey));
    return NextResponse.json({ configured: true, ok: true, publicKey: status.publicKey, solBalance: lamports / LAMPORTS_PER_SOL });
  } catch {
    return NextResponse.json({ configured: true, ok: true, publicKey: status.publicKey, solBalance: null });
  }
}
