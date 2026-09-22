import { NextResponse } from "next/server";
import { OTC_REWARD_ASSETS } from "@/lib/otc/reward-assets";

/** The reward assets a PANDA Rewards launch may pick as `quoteMint` — see src/lib/otc/reward-assets.ts
 * for where this list comes from and why it isn't fetched from OTC itself (no public list endpoint
 * is documented). Static and cheap, so no rate limit needed. */
export async function GET() {
  return NextResponse.json({ assets: OTC_REWARD_ASSETS });
}
