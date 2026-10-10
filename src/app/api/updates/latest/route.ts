import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { pgListUpdates } from "@/lib/db/updates";

/**
 * Public, read-only: the newest entry of the Updates page (its address, day and title in both languages) — what the
 * "new" dot in the menu and the home page's small card read. `null` when nothing is published or it can't be read:
 * neither is ever a reason to show an error.
 */
export async function GET() {
  let latest: { id: string; ts: number; tag: string; title: { en: string; es: string } } | null = null;
  try {
    const [first] = await pgListUpdates(getDb(), "newest", 1);
    if (first) latest = { id: first.id, ts: first.ts, tag: first.tag, title: first.title };
  } catch {
    latest = null;
  }
  return NextResponse.json({ latest }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } });
}
