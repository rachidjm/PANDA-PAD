import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { getLedger } from "@/lib/rewards/ledger";
import { sumRewards } from "@/lib/portfolio/view";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Ledgers read per request (each is a storage read): keeps the call inside the serverless time limit. */
const MAX_LEDGERS = 120;

/**
 * Public, read-only: what this wallet has earned as a holder across every PANDA coin, straight from the
 * rewards ledgers (exact lamports). Claiming stays on the Rewards page, behind a signed-in session.
 * `partial` is true when there were more coins than one request reads.
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (rateLimited(`portfolio-rewards:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  try {
    const mints = await getRegisteredMints();
    const read = mints.slice(0, MAX_LEDGERS);
    const ledgers = [];
    for (let i = 0; i < read.length; i += 10) ledgers.push(...(await Promise.all(read.slice(i, i + 10).map(getLedger))));
    return NextResponse.json({ ...sumRewards(ledgers, wallet), partial: mints.length > read.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read rewards." }, { status: 500 });
  }
}
