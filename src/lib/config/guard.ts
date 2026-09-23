import { NextResponse } from "next/server";
import { isEnabled, type Feature } from "./flags";

const NAMES: Partial<Record<Feature, string>> = {
  STRATEGIES: "Stop Loss / Take Profit and Draw Your Trade (custodial Jupiter vault)",
  OTC_REWARDS: "PANDA Rewards launches (OTC)",
};

/**
 * Call first in any route that belongs to a feature behind a flag. Returns the 403 to send back when the flag is off
 * (with a message that says why, and a stable `code` for the UI), otherwise null. Hiding a button is a courtesy; this
 * is the control: a direct request to a route of a switched-off feature is refused.
 */
export function featureDisabledResponse(feature: Feature, env: Record<string, string | undefined> = process.env): NextResponse | null {
  if (isEnabled(feature, env)) return null;
  return NextResponse.json(
    { error: `${NAMES[feature] ?? feature} is not enabled on this deployment.`, code: "FEATURE_DISABLED", feature },
    { status: 403 }
  );
}
