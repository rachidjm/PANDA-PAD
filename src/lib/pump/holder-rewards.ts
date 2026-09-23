/**
 * Holder rewards (a share of a coin's creator fees routed to PANDA's Rewards Pool wallet, paid to holders when they claim)
 * are behind FEATURE_HOLDER_REWARDS, off by default: the pool wallet is custodied by PANDA's servers and nothing of that flow
 * has been signed on mainnet. With the flag off, Create doesn't offer the band AND the server refuses any split that
 * includes the pool's address — hiding a row is a courtesy, this is the control.
 */
export function holderShareIssue(
  shareholders: { address: string }[],
  opts: { enabled: boolean; pool: string | null }
): string | null {
  if (opts.enabled || !opts.pool) return null;
  return shareholders.some((s) => s.address === opts.pool) ? "Holder rewards are not enabled on this deployment: that split includes the Holders share." : null;
}
