import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { confirmCancel } from "@/lib/jupiter/trigger";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = featureDisabledResponse("STRATEGIES");
  if (disabled) return disabled;
  try {
    const { id } = await params;
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const { signedTransaction, cancelRequestId } = await req.json();
    if (!signedTransaction || !cancelRequestId) {
      return NextResponse.json({ error: "Missing signedTransaction or cancelRequestId." }, { status: 400 });
    }
    const result = await confirmCancel(id, { signedTransaction, cancelRequestId }, token);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to confirm the cancellation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
