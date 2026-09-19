import { Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export type TokenHolder = { address: string; amount: number };

/**
 * Real, on-chain SPL token holders for a mint — every non-zero token
 * account, read directly from the Token Program (no registry, no PANDA-side
 * bookkeeping to go stale). Capped to the largest `limit` holders by
 * balance: a real scale limit for the daily collect-fees cron's bounded time
 * budget (Vercel Hobby's 30s function limit) — a very widely-held coin's
 * smaller holders may not get credited in a given cycle. Documented, not
 * hidden; revisit with pagination/batching if this becomes a real problem.
 */
export async function getTokenHolders(connection: Connection, mint: string, limit = 500): Promise<TokenHolder[]> {
  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  });

  const holders: TokenHolder[] = [];
  for (const { account } of accounts) {
    const parsed = (account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { uiAmount?: number | null } } } }).parsed;
    const owner = parsed?.info?.owner;
    const amount = parsed?.info?.tokenAmount?.uiAmount;
    if (owner && amount && amount > 0) holders.push({ address: owner, amount });
  }

  return holders.sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export function totalHolderAmount(holders: TokenHolder[]): number {
  return holders.reduce((sum, h) => sum + h.amount, 0);
}
