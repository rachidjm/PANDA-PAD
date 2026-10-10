import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** `amount` is the raw on-chain balance in the token's smallest units (integer, exact) — never a float. */
export type TokenHolder = { address: string; amount: bigint };

/** A token account's raw balance (base units, decimal string) as a bigint; null for anything that isn't a plain non-negative integer. */
export function parseRawAmount(raw: unknown): bigint | null {
  return typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

/**
 * Turns the token program's parsed accounts into holders: every token account of the coin with a balance, largest first,
 * capped to `limit`. Anything that isn't a token account (Token-2022 also keeps mints and other account types) is skipped.
 */
export function holdersFromAccounts(accounts: readonly { account: { data: unknown } }[], limit: number): TokenHolder[] {
  const holders: TokenHolder[] = [];
  for (const { account } of accounts) {
    const parsed = (account.data as { parsed?: { type?: string; info?: { owner?: string; tokenAmount?: { amount?: string } } } }).parsed;
    if (parsed?.type !== undefined && parsed.type !== "account") continue;
    const owner = parsed?.info?.owner;
    const amount = parseRawAmount(parsed?.info?.tokenAmount?.amount);
    if (owner && amount !== null && amount > BigInt(0)) holders.push({ address: owner, amount });
  }
  return holders.sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1)).slice(0, limit);
}

/** Which token program a coin lives in — the classic one or Token-2022 (what Pump.fun creates coins with now). Null if it is neither. */
export function tokenProgramOf(mintOwner: PublicKey | null | undefined): PublicKey | null {
  if (!mintOwner) return null;
  if (mintOwner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (mintOwner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return null;
}

/**
 * Real, on-chain token holders for a mint — every non-zero token account, read directly from the token program the
 * coin really lives in (no registry, no PANDA-side bookkeeping to go stale). Reading only the classic program found
 * NOBODY for a Token-2022 coin, and the rewards cron then credited nobody. Capped to the largest `limit` holders by
 * balance: a real scale limit for the collect-fees cron's bounded time budget — a very widely-held coin's smaller
 * holders may not get credited in a given cycle. Documented, not hidden.
 */
export async function getTokenHolders(connection: Connection, mint: string, limit = 500): Promise<TokenHolder[]> {
  const program = tokenProgramOf((await connection.getAccountInfo(new PublicKey(mint)))?.owner);
  if (!program) return [];
  // A classic token account is always 165 bytes; a Token-2022 one is longer when it carries extensions, so only the coin is matched.
  const filters = program.equals(TOKEN_PROGRAM_ID) ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }] : [{ memcmp: { offset: 0, bytes: mint } }];
  const accounts = await connection.getParsedProgramAccounts(program, { filters });
  return holdersFromAccounts(accounts, limit);
}
