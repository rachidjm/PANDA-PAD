/**
 * Feature flags for the risky, not-yet-launched systems. Every flag is OFF
 * unless its server-only env var is exactly "true" — so a missing or
 * mistyped variable fails closed. Server-side only: a route behind a flag
 * must check it itself; hiding a button in the UI is not the control.
 */
export const FEATURES = [
  "NFT_THEMES",
  "NFT_BRANCHES",
  "NFT_MARKET",
  "NFT_SECONDARY",
  "PANDA_POINTS",
  "PANDA_AIRDROPS",
  "CREATOR_REWARDS",
  "MERKLE_CLAIMS",
  // Launch scope: everything below moves money that has never been signed on mainnet, or needs a custodian.
  "STRATEGIES", // Draw Your Trade + Stop Loss / Take Profit — custodial (Jupiter Trigger vault, held by Privy)
  "OTC_REWARDS", // the Rewards mode of /create (OTC / Meteora launcher)
  "HOLDER_REWARDS", // the "Holders" band of a Standard coin's creator-fee split (Rewards Pool wallet, custodied by PANDA's servers)
] as const;

export type Feature = (typeof FEATURES)[number];

export function isEnabled(feature: Feature, env: Record<string, string | undefined> = process.env): boolean {
  return env[`FEATURE_${feature}`] === "true";
}
