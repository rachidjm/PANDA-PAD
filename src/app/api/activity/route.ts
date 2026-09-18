import { NextResponse } from "next/server";
import { getRecentActivity } from "@/lib/live-coins";

export async function GET() {
  const { events, live } = await getRecentActivity();
  return NextResponse.json({ events, live });
}
