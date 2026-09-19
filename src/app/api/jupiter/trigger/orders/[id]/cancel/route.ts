import { NextResponse } from "next/server";
import { craftCancel } from "@/lib/jupiter/trigger";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
