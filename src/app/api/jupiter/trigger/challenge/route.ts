import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { getAuthChallenge } from "@/lib/jupiter/trigger";

export async function POST(req: Request) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
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
