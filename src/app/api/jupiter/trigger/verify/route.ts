import { NextResponse } from "next/server";
import { verifyAuthChallenge } from "@/lib/jupiter/trigger";

export async function POST(req: Request) {
  try {
    const { walletPubkey, signature } = await req.json();
    if (!walletPubkey || !signature) {
      return NextResponse.json({ error: "Missing walletPubkey or signature." }, { status: 400 });
    }
    const result = await verifyAuthChallenge(walletPubkey, signature);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to verify the signed challenge.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
