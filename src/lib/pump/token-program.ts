import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Which token program a coin's mint belongs to. Pump.fun launches its coins on Token-2022 now, older ones on the
 * classic SPL Token program, and every account and instruction of a trade must name the right one: building a buy for a
 * Token-2022 coin with the classic program fails inside the wallet's transaction ("incorrect program id" when the
 * token account is created), for EVERY buyer, every time.
 */

/** The token program that owns a mint account, or null when the owner isn't a token program at all. */
export function tokenProgramForOwner(owner: string | PublicKey): PublicKey | null {
  const key = typeof owner === "string" ? owner : owner.toBase58();
  if (key === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (key === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  return null;
}

export async function tokenProgramOf(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error("That token wasn't found on-chain.");
  const program = tokenProgramForOwner(info.owner);
  if (!program) throw new Error("That address isn't a token mint.");
  return program;
}
