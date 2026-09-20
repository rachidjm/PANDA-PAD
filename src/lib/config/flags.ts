/**
 * Feature flags for the risky, not-yet-launched systems. Every flag is OFF
 * unless its server-only env var is exactly "true" — so a missing or
 * mistyped variable fails closed. Server-side only: a route behind a flag
 * must check it itself; hiding a button in the UI is not the control.
 */
export const FEATURES = [
  "NFT_THEMES",
  "NFT_MARKET",
  "NFT_SECONDARY",
  "PANDA_POINTS",
  "PANDA_AIRDROPS",
  "CREATOR_REWARDS",
  "MERKLE_CLAIMS",
] as const;

export type Feature = (typeof FEATURES)[number];

export function isEnabled(feature: Feature, env: Record<string, string | undefined> = process.env): boolean {
  return env[`FEATURE_${feature}`] === "true";
}
