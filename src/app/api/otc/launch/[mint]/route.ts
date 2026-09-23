import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { getOtcLaunch } from "@/lib/otc/store";
import { isValidPublicKey } from "@/lib/otc/validate";

/** Reads back PANDA's own record of an OTC launch attempt — how a reloaded tab, or a launch that
 * errored after TX2 landed, finds its way back to "resume" instead of starting a second mint. */
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  const { mint } = await params;
  if (!isValidPublicKey(mint)) return NextResponse.json({ error: "Invalid mint." }, { status: 400 });
  const launch = await getOtcLaunch(mint);
  if (!launch) return NextResponse.json({ error: "No launch found for this mint." }, { status: 404 });
  return NextResponse.json({ launch });
}
