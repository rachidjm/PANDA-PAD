import { NextResponse } from "next/server";
import { getLiveCoins } from "@/lib/live-coins";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const { coins, live } = await getLiveCoins({ force });
  return NextResponse.json({ coins, live });
}
