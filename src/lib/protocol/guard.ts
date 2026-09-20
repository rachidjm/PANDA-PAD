import { NextResponse } from "next/server";
import { checkActive } from "./pause-store";
import { Subsystem } from "./pause";

/**
 * Call at the top of any route that starts new work in `subsystem`. Returns a
 * 503 to send back if that subsystem is paused (or its status can't be
 * verified), otherwise null. `code: "PAUSED"` lets the UI show the banner.
 */
export async function pausedResponse(subsystem: Subsystem): Promise<NextResponse | null> {
  const { paused, reason } = await checkActive(subsystem);
  if (!paused) return null;
  return NextResponse.json(
    { error: reason ? `PANDA protocol paused: ${reason}` : "PANDA protocol paused.", code: "PAUSED", subsystem },
    { status: 503 }
  );
}
