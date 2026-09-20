import { Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** `amount` is the raw on-chain balance in the token's smallest units (integer, exact) — never a float. */
export type TokenHolder = { address: string; amount: bigint };

/**
 * Real, on-chain SPL token holders for a mint — every non-zero token
 * account, read directly from the Token Program (no registry, no PANDA-side
 * bookkeeping to go stale). Capped to the largest `limit` holders by
 * balance: a real scale limit for the daily collect-fees cron's bounded time
 * budget (Vercel Hobby's 30s function limit) — a very widely-held coin's
 * smaller holders may not get credited in a given cycle. Documented, not
 * hidden; revisit with pagination/batching if this becomes a real problem.
 */
/** A token account's raw balance (base units, decimal string) as a bigint; null for anything that isn't a plain non-negative integer. */
export function parseRawAmount(raw: unknown): bigint | null {
  return typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

export async function getTokenHolders(connection: Connection, mint: string, limit = 500): Promise<TokenHolder[]> {
  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  });

  const holders: TokenHolder[] = [];
  for (const { account } of accounts) {
    const parsed = (account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } }).parsed;
    const owner = parsed?.info?.owner;
    const raw = parsed?.info?.tokenAmount?.amount;
    const amount = parseRawAmount(raw);
    if (owner && amount !== null && amount > BigInt(0)) holders.push({ address: owner, amount });
  }

  return holders.sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1)).slice(0, limit);
}
