import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgListReferralPayouts } from "@/lib/db/referrals";
import { isPeriodKey, periodRange } from "@/lib/referrals/period";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A CSV export is still one page, just the largest one allowed — never literally "everything", so a very
 *  active recruiter's export can't turn into an unbounded query. */
const MAX_CSV_ROWS = 2000;

function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Public, read-only: `referrer`'s own verified on-chain payouts (src/lib/db/schema.ts's referralPayouts),
 *  filtered by period/mint/search and paginated — the Recruiters page's payment history. `format=csv` returns
 *  the same filtered rows as a download instead of JSON, capped at MAX_CSV_ROWS. */
export async function GET(req: Request) {
  if (!isEnabled("REFERRALS")) return NextResponse.json({ error: "The Recruiters program isn't on." }, { status: 404 });
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet || !ADDRESS.test(wallet)) return NextResponse.json({ error: "Missing or invalid wallet." }, { status: 400 });
  if (await rateLimited(`referrals-payouts:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const periodParam = url.searchParams.get("period");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const range = periodRange(
    { key: isPeriodKey(periodParam) ? periodParam : "all", from: fromParam ? Number(fromParam) : undefined, to: toParam ? Number(toParam) : undefined },
    Date.now()
  );
  const mint = url.searchParams.get("mint")?.trim() || undefined;
  const q = url.searchParams.get("q")?.trim().slice(0, 64) || undefined;
  const format = url.searchParams.get("format");
  const limit = format === "csv" ? MAX_CSV_ROWS : Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = format === "csv" ? 0 : Math.max(0, Number(url.searchParams.get("offset")) || 0);

  try {
    const db = getDb();
    const { rows, total } = await pgListReferralPayouts(db, wallet, { from: range?.from, to: range?.to, mint, q, limit, offset });
    if (format === "csv") {
      const header = "signature,invitee_wallet,mint,sol,date_utc\n";
      const body = rows.map((r) => [r.signature, r.referred, r.mint, (r.lamports / 1e9).toString(), new Date(r.ts).toISOString()].map(csvField).join(",")).join("\n");
      return new NextResponse(header + (body ? `${body}\n` : ""), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="panda-recruiters-payouts.csv"', "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ payouts: rows, total }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return NextResponse.json({ payouts: [], total: 0 });
    return NextResponse.json({ error: "Couldn't read your payouts right now." }, { status: 500 });
  }
}
