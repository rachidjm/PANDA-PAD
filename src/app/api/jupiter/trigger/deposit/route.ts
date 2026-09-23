import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { craftDeposit } from "@/lib/jupiter/trigger";

export async function POST(req: Request) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  try {
    const { inputMint, outputMint, userAddress, amount, orderSubType } = await req.json();
    if (!inputMint || !outputMint || !userAddress || !amount) {
      return NextResponse.json({ error: "Missing inputMint, outputMint, userAddress or amount." }, { status: 400 });
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || undefined;
    const craft = await craftDeposit({ inputMint, outputMint, userAddress, amount, orderType: "price", orderSubType }, token);
    return NextResponse.json(craft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to craft the deposit transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
