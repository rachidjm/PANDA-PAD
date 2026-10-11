import { NextResponse } from "next/server";
import { burnEnabled } from "@/lib/burn/config";
import { getDb } from "@/lib/db/client";
import { pgBurnSummary } from "@/lib/db/burn";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { walletKey } from "@/lib/telegram/link";

/**
 * ?mint=<address>: what PANDA's burn wallet has burned of that coin — the total (raw and as a plain figure), how many
 * burns, and the latest ones with their transactions. Public, read-only, confirmed transactions only. 404 with the flag off.
 */
export async function GET(req: Request) {
  if (!burnEnabled()) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`burn-summary:${clientIp(req)}`, 120, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const mint = walletKey(new URL(req.url).searchParams.get("mint"));
  if (!mint) return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  try {
    const s = await pgBurnSummary(getDb(), mint);
    const tokens = s.decimals !== null ? Number(BigInt(s.tokensBurned)) / 10 ** s.decimals : 0;
    return NextResponse.json(
      { mint, tokensBurnedRaw: s.tokensBurned, decimals: s.decimals, tokensBurned: tokens, burns: s.burns, solSpent: s.lamportsSpent / 1e9, recent: s.recent },
      { headers: { "Cache-Control": "public, max-age=30" } }
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
