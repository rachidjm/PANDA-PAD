import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { listOrders } from "@/lib/jupiter/trigger";

export async function GET(req: Request) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state");
    const mint = searchParams.get("mint");
    const result = await listOrders(token, {
      state: state === "active" || state === "past" ? state : undefined,
      mint: mint || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list orders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
