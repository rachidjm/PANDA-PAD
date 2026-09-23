import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { featureDisabledResponse } from "@/lib/config/guard";
import { craftCancel } from "@/lib/jupiter/trigger";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  try {
    const { id } = await params;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const craft = await craftCancel(id, token);
    return NextResponse.json(craft);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to craft the cancellation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
