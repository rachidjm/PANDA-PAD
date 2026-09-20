/**
 * Every tunable number of the branch system, in one place and under a version. The eligibility numbers are the
 * spec's own examples (50 unique buyers, 1 SOL, a holding period, no abuse flags) and are meant to be changed:
 * a new value means a new version so an old decision can always be read with the rules that produced it.
 */

export const BRANCH_CONFIG_VERSION = "v1";

export const BRANCH_CONFIG = {
  version: BRANCH_CONFIG_VERSION,

  /**
   * What a creator must have achieved in ONE theme to open a branch there. Measured over all of their NFTs in that
   * theme (a single artwork can have only one owner at a time, so "50 unique buyers" can only be reached across a body of work).
   */
  eligibility: {
    /** Different wallets that bought from the creator, legitimately, and held what they bought for at least `minHoldMs`. */
    minUniqueBuyers: 50,
    /** Total price (lamports) of the legitimate sales: 1 SOL. */
    minVolumeLamports: 1_000_000_000,
    /** A buyer only counts once they have held the NFT this long (or still hold it). Blocks flips and quick round trips. */
    minHoldMs: 24 * 3_600_000,
  },

  title: { min: 3, max: 24 },
  description: { max: 300 },

  /** Branches one creator may have open in one theme, and overall. */
  maxPerCreatorPerTheme: 1,
  maxPerCreator: 5,
  /** NFTs one wallet may create in one branch, and NFTs in a whole branch. */
  creationLimitPerWallet: 20,
  maxNftsPerBranch: 1_000,
  /** Wallets the creator may explicitly allow to add NFTs to the branch (besides themselves). */
  maxContributors: 5,

  /** Branches may keep growing after their theme closes — the theme itself stays immutable. */
  branchesOutliveTheme: true,
} as const;
