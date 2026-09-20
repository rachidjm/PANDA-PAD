import type { WalletProfile } from "./types";

/**
 * Finds facts about a wallet's beginning: when it first appeared and who sent it
 * its first SOL. The chain is reached through this small interface so the logic
 * is testable without a network (see deps.ts for the real implementation).
 *
 * Honesty about limits: a wallet with a very long history is never followed back to
 * its origin (each page is an RPC call), so `reachedOrigin` is false and NO funder is
 * claimed — an unknown funder produces no signal, never a guess.
 */

export type SignatureInfo = { signature: string; blockTime: number | null; failed: boolean };
export type SolDelta = { account: string; delta: number; signer: boolean };

export type ChainHistory = {
  /** Newest-first page of the wallet's transactions, older than `before` when given. */
  signatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]>;
  /** Every account's SOL balance change in one transaction, or null if the transaction can't be read. */
  solDeltas(signature: string): Promise<SolDelta[] | null>;
};

export const PROFILE_PAGE_SIZE = 1000;
export const PROFILE_MAX_PAGES = 3;

export async function lookupProfile(wallet: string, chain: ChainHistory, opts: { pageSize?: number; maxPages?: number } = {}): Promise<WalletProfile> {
  const pageSize = opts.pageSize ?? PROFILE_PAGE_SIZE;
  const maxPages = opts.maxPages ?? PROFILE_MAX_PAGES;

  let before: string | undefined;
  let oldestPage: SignatureInfo[] = [];
  let reachedOrigin = false;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await chain.signatures(wallet, { before, limit: pageSize });
    if (sigs.length === 0) {
      reachedOrigin = true;
      break;
    }
    oldestPage = sigs;
    if (sigs.length < pageSize) {
      reachedOrigin = true;
      break;
    }
    before = sigs[sigs.length - 1].signature;
  }

  if (oldestPage.length === 0) return { wallet, firstSeenTs: null, reachedOrigin, funder: null };

  // Pages are newest-first, so the oldest transaction is last.
  const oldest = [...oldestPage].reverse();
  const first = oldest.find((s) => s.blockTime !== null);
  const firstSeenTs = first?.blockTime != null ? first.blockTime * 1000 : null;
  if (!reachedOrigin) return { wallet, firstSeenTs, reachedOrigin: false, funder: null };

  // The funder is whoever paid the wallet in its oldest SUCCESSFUL transaction, if that transaction was a funding.
  const funding = oldest.find((s) => !s.failed);
  let funder: string | null = null;
  if (funding) {
    const deltas = await chain.solDeltas(funding.signature);
    const mine = deltas?.find((d) => d.account === wallet);
    if (deltas && mine && mine.delta > 0) {
      const payer = deltas.filter((d) => d.signer && d.delta < 0 && d.account !== wallet).sort((a, b) => a.delta - b.delta)[0];
      funder = payer?.account ?? null;
    }
  }
  return { wallet, firstSeenTs, reachedOrigin: true, funder };
}
