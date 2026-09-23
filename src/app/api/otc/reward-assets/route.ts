import { NextResponse } from "next/server";
import { featureDisabledResponse } from "@/lib/config/guard";
import { OTC_REWARD_ASSETS } from "@/lib/otc/reward-assets";

/** The reward assets a PANDA Rewards launch may pick as `quoteMint` — see src/lib/otc/reward-assets.ts
 * for where this list comes from and why it isn't fetched from OTC itself (no public list endpoint
 * is documented). Static and cheap, so no rate limit needed. */
export async function GET() {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  return NextResponse.json({ assets: OTC_REWARD_ASSETS });
}
