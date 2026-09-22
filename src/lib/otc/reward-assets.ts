/**
 * The reward assets PANDA Rewards (OTC) launches are allowed to pay holders in.
 *
 * OTC's own docs (https://otcdesks.cash/docs, "The fields" / "Choosing the
 * reward") state that `quoteMint` "has to be one of the assets this site
 * offers — checked on the server, not taken from your request" but do not
 * document a public endpoint that lists them. Per that same page's own
 * "REFERENCE → The accounts → STOCKS IN ROTATION" table (addresses read live
 * from chain, confirmed by pulling the full addresses from that page's own
 * links — not guessed), these 13 are the real, currently-offered assets. This
 * file is the single, easily-updatable place that list lives — nothing else
 * in the app should hardcode a reward-asset mint.
 *
 * SOL / USDC / $PANDA are deliberately NOT included here: OTC's docs never
 * confirm those as valid `quoteMint` values for its own fee-conversion
 * mechanism (the whole point of OTC is paying holders in a tokenised
 * stock-like asset), and inventing that would violate "no adivinar" for the
 * one field OTC explicitly locks at launch and can never change. Extend this
 * list only from what OTC's own docs/site confirm.
 */

export type OtcRewardAsset = {
  mint: string;
  /** OTC's own display symbol/ticker for this asset. */
  symbol: string;
  /** A short, honest human name — not a claim about the asset's legal status. */
  name: string;
};

export const OTC_REWARD_ASSETS: readonly OtcRewardAsset[] = [
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", symbol: "AAPLx", name: "Apple" },
  { mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", symbol: "MSFTx", name: "Microsoft" },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx", name: "NVIDIA" },
  { mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", symbol: "AMZNx", name: "Amazon" },
  { mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", symbol: "CRCLx", name: "Circle" },
  { mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", symbol: "SPCXx", name: "SpaceX" },
  { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", symbol: "ANTHROPIC", name: "Anthropic" },
  { mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", symbol: "POLYMARKET", name: "Polymarket" },
  { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", symbol: "KALSHI", name: "Kalshi" },
  { mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", symbol: "NEURALINK", name: "Neuralink" },
  { mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", symbol: "OTC", name: "OTC" },
  { mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", symbol: "ANDURIL", name: "Anduril" },
  { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", symbol: "OPENAI", name: "OpenAI" },
] as const;

const BY_MINT = new Map(OTC_REWARD_ASSETS.map((a) => [a.mint, a] as const));

export function isValidOtcRewardAsset(mint: string): boolean {
  return BY_MINT.has(mint);
}

export function otcRewardAssetByMint(mint: string): OtcRewardAsset | undefined {
  return BY_MINT.get(mint);
}
