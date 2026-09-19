import { NextResponse } from "next/server";
import { getAuthChallenge } from "@/lib/jupiter/trigger";

export async function POST(req: Request) {
  try {
    const { walletPubkey } = await req.json();
    if (!walletPubkey) return NextResponse.json({ error: "Missing walletPubkey." }, { status: 400 });
    const challenge = await getAuthChallenge(walletPubkey);
    return NextResponse.json(challenge);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get an auth challenge.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
