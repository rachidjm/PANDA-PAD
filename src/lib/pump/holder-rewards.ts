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

/**
 * The same control for the Burn share (FEATURE_BURN): with the flag off — or with no burn wallet configured — the server
 * refuses any split that pays the burn wallet. The creator's own wallet can never be the burn wallet either: that share
 * is bought and burned by PANDA's server, not by whoever names an address.
 */
export function burnShareIssue(shareholders: { address: string }[], opts: { enabled: boolean; wallet: string | null }): string | null {
  if (!opts.wallet) return null; // nothing to recognise it by: no split can include it
  if (opts.enabled) return null;
  return shareholders.some((s) => s.address === opts.wallet) ? "Burn is not enabled on this deployment: that split includes the Burn share." : null;
}
