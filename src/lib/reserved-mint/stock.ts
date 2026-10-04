import { Keypair } from "@solana/web3.js";
import { DbNotConfiguredError, getDb, type Db } from "@/lib/db/client";
import { pgClaimReservedMintKey, pgGetReservedMintKey } from "@/lib/db/reserved-mint";
import { decryptSecretKey } from "./crypto";
import { alertOps } from "@/lib/alerts";
import { claimMintKeypair, type MintKeypairResult } from "@/lib/vanity/stock";

/** The one wallet this reservation exists for — nobody else, ever, regardless of ticker. */
export const RESERVED_PANDA_CREATOR = "35gHkr4E2NuvemMqMLSjRXx2jsqaVf6FnuBjs7yqRVkh";
/** The row's `purpose` key in reserved_mint_keys — a name, not a secret. */
export const PANDA_TOKEN_RESERVED_PURPOSE = "panda_token";

/** Whether this specific (wallet, ticker) pair is the one reservation this module knows about. Never matches
 *  any other wallet, and never matches this wallet launching anything other than ticker "PANDA". */
export function isReservedPandaLaunch(user: string, symbol: string): boolean {
  return user === RESERVED_PANDA_CREATOR && symbol.trim().toUpperCase() === "PANDA";
}

/**
 * The mint keypair for a coin launch. When `user`+`symbol` match the one reservation (isReservedPandaLaunch),
 * tries the reserved "…panda" address FIRST — falling back to the ordinary vanity-stock-or-random path
 * (src/lib/vanity/stock.ts) on ANY failure (not imported yet, already used once, a decrypt failure). For every
 * other wallet or ticker, this is identical to calling claimMintKeypair() directly. Never a reason a launch is
 * blocked, delayed or refused.
 */
export async function claimLaunchMintKeypair(user: string, symbol: string): Promise<MintKeypairResult> {
  if (isReservedPandaLaunch(user, symbol)) {
    const reserved = await claimReservedPandaKeypair();
    if (reserved) return { keypair: reserved, vanity: true };
  }
  return claimMintKeypair();
}

/** Decrypts and marks USED the one reserved $PANDA keypair — never more than once, ever. Null on any failure
 *  (not imported yet, already used, row missing, decrypt failure), alerting ops so it's noticed. */
async function claimReservedPandaKeypair(): Promise<Keypair | null> {
  let db: Db;
  try {
    db = getDb();
  } catch (err) {
    if (!(err instanceof DbNotConfiguredError)) console.error("[PANDA reserved-mint] db unavailable", err instanceof Error ? err.message : err);
    return null;
  }
  try {
    const row = await pgClaimReservedMintKey(db, PANDA_TOKEN_RESERVED_PURPOSE);
    if (!row) {
      await alertOps("reserved_mint.not_available", { purpose: PANDA_TOKEN_RESERVED_PURPOSE });
      return null;
    }
    const secret = decryptSecretKey(row);
    if (!secret) {
      // Already marked used — this reservation is spent either way (RESERVED_MINT_KEY changed, or a corrupt
      // row), so falling back is strictly better than failing the one $PANDA launch over it.
      await alertOps("reserved_mint.decrypt_failed", { purpose: PANDA_TOKEN_RESERVED_PURPOSE, pubkey: row.pubkey });
      return null;
    }
    return Keypair.fromSecretKey(secret);
  } catch (err) {
    console.error("[PANDA reserved-mint] claim failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Read-only peek at the reserved keypair — NEVER marks it used. For status checks and simulated/dry-run
 *  transactions only (src/app/api/admin/reserved-mint/route.ts); never called from the real create route. */
export async function peekReservedPandaKeypair(): Promise<Keypair | null> {
  let db: Db;
  try {
    db = getDb();
  } catch {
    return null;
  }
  const row = await pgGetReservedMintKey(db, PANDA_TOKEN_RESERVED_PURPOSE);
  if (!row) return null;
  const secret = decryptSecretKey(row);
  return secret ? Keypair.fromSecretKey(secret) : null;
}
