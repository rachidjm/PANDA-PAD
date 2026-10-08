import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Just the mint addresses a wallet holds a nonzero balance of — both token programs (Pump.fun launches under
 * Token-2022), no prices, no names, no images. For search's "never hide a coin the user holds" rule, which only
 * needs to know WHICH mints to protect, not what they're worth — the full `getWalletPortfolio` in portfolio.ts
 * does far more work (metadata lookups, SOL balance, totals) than that needs.
 */
export async function getHeldMints(connection: Connection, owner: PublicKey): Promise<string[]> {
  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);
  const mints = new Set<string>();
  for (const acc of [...classic.value, ...token2022.value]) {
    const info = acc.account.data.parsed?.info;
    if ((info?.tokenAmount?.uiAmount ?? 0) > 0) mints.add(info.mint as string);
  }
  return [...mints];
}
