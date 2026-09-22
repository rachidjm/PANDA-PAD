/** The lifecycle of one PANDA Rewards (OTC) launch attempt, one mint at a time. */
export const OTC_LAUNCH_STATUSES = [
  "DRAFT",
  "VALIDATING",
  "METADATA_CREATED",
  "LAUNCH_BUILDING",
  "AWAITING_SIGNATURE",
  "TX1_PENDING",
  "TX1_CONFIRMED",
  "TX2_PENDING",
  "CONFIRMED",
  "FAILED",
] as const;

export type OtcLaunchStatus = (typeof OTC_LAUNCH_STATUSES)[number];

/**
 * PANDA's own record of one OTC/Meteora launch attempt — public, non-secret facts only (never the
 * mint's secret key: see src/lib/otc/client.ts and OtcRewardsCreate.tsx, which hold it in memory
 * only for as long as it takes to sign the second transaction). One document per mint
 * (src/lib/otc/store.ts), so "does a launch already exist for this mint" is always a real question
 * this record can answer — the idempotency guard rule #13/#21 in the spec depends on.
 */
export type OtcLaunchRecord = {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  quoteMint: string;
  mode: "low" | "high";
  buy: string;
  status: OtcLaunchStatus;
  /** From POST /api/meteora/launch — the pool config this launch created. */
  config?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  quoteUsd?: number;
  tx1Signature?: string;
  tx2Signature?: string;
  /** Whether POST /api/coins (registering the coin with OTC's own board) has succeeded — separate
   * from `status`, because the launch itself is already real and earning the moment TX2 confirms;
   * registration is the optional, retryable "list it" step described in the docs. */
  registered: boolean;
  registerError?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
