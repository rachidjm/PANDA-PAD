import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { getRawSharingConfig } from "@/lib/pump/fee-sharing";
import { PANDA_REWARDS_POOL, PANDA_TREASURY } from "@/lib/pump/constants";

/**
 * Who is NOT a holder for rewards, decided in one place and used both when a distribution is split and when it is paid:
 *
 *  - the coin's own fee-split shareholders (the creator, PANDA's treasury, the Rewards Pool itself): distributeCreatorFees
 *    already paid them their share directly;
 *  - anything that isn't a plain, ordinary wallet — the bonding curve, the AMM pool, any other program's account — checked
 *    for real against what each address is owned by, never guessed from a derivation that could go stale.
 *
 * They are left out BEFORE the split. Splitting first and dropping them afterwards gave the bonding curve (which holds
 * most of a young coin) most of the Holders share, which then could never be paid to anyone.
 */

const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const ACCOUNTS_PER_CALL = 100; // getMultipleAccounts' own limit

/** An address with no account yet (never funded) or owned by the System Program is an ordinary wallet; anything else belongs to a program. */
export function isOrdinaryWallet(accountOwner: string | null | undefined): boolean {
  return !accountOwner || accountOwner === SYSTEM_PROGRAM;
}

export async function ineligibleHolders(connection: Connection, mint: string, wallets: readonly string[]): Promise<Set<string>> {
  const raw = await getRawSharingConfig(connection, new PublicKey(mint)).catch(() => null);
  const exclude = new Set<string>([
    ...(raw ? raw.config.shareholders.map((s) => s.address.toBase58()) : []),
    PANDA_TREASURY.toBase58(),
    ...(PANDA_REWARDS_POOL ? [PANDA_REWARDS_POOL.toBase58()] : []),
  ]);
  const candidates = wallets.filter((w) => !exclude.has(w));
  for (let i = 0; i < candidates.length; i += ACCOUNTS_PER_CALL) {
    const chunk = candidates.slice(i, i + ACCOUNTS_PER_CALL);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((w) => new PublicKey(w)));
    chunk.forEach((w, k) => {
      if (!isOrdinaryWallet(infos[k]?.owner?.toBase58())) exclude.add(w);
    });
  }
  return exclude;
}
