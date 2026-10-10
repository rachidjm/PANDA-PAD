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
  "STRATEGIES", // Draw Your Trade strategies with a buy — custodial (Jupiter Trigger vault, held by Privy)
  "OTC_REWARDS", // the Rewards mode of /create (OTC / Meteora launcher)
  "HOLDER_REWARDS", // the "Holders" band of a Standard coin's creator-fee split (Rewards Pool wallet, custodied by PANDA's servers)
  "REFERRALS", // the Recruiters program — a marginal-tier share of PANDA's trade fee paid straight to the recruiter inside the trade's own transaction
  "FOUNDER_NFT", // the 1,000 permanent Founder slots (flat 30% share, soulbound NFT once the collection exists) — requires REFERRALS
  "FOUNDER_PANDA_REWARDS", // Founders' daily variable $PANDA accrual + claim — requires FOUNDER_NFT and a real $PANDA mint
  "PANDA_ORDERS", // PANDA orders: pre-signed sells / stops on a held Pump.fun / PumpSwap coin (durable nonce) — non-custodial, PANDA only sends what the user signed
  "TELEGRAM_BOT", // the PANDA Telegram bot (webhook, automatic posts, personal alerts, wallet linking) — docs/TELEGRAM.md
  "TELEGRAM_CHANGELOG", // public changelog: a draft is sent to the admins in private and only published to the channel when one presses "Publicar" — requires TELEGRAM_BOT
  "AI_ASSISTANT", // GPT-6 Luna assistant (create-with-AI, analyze a coin, Draw Your Trade help, search) — needs OPENAI_API_KEY
] as const;

export type Feature = (typeof FEATURES)[number];

export function isEnabled(feature: Feature, env: Record<string, string | undefined> = process.env): boolean {
  return env[`FEATURE_${feature}`] === "true";
}
