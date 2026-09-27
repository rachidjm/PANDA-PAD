import { Keypair } from "@solana/web3.js";
import { DbNotConfiguredError, getDb, type Db } from "@/lib/db/client";
import { pgClaimVanityKey, pgVanityStockCount } from "@/lib/db/vanity";
import { decryptSecretKey, hasVanityStockKey } from "./crypto";
import { alertOps } from "@/lib/alerts";

/** Lowercase, matches solana-keygen grind's own case-sensitive matching (see scripts/vanity-grind.md). */
export const MINT_SUFFIX = "panda";

export type MintKeypairResult = { keypair: Keypair; vanity: boolean };

const LOW_STOCK_THRESHOLD = 20;
/** Never spams the alert channel more than once per this long, however many launches claim the last few keys. */
const LOW_STOCK_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;
let lastLowStockAlert = 0;

/**
 * The mint keypair for a new coin launch: a pre-generated address ending in "panda" from the stock, when one
 * is available — otherwise a plain random keypair, and NEVER a reason a launch is blocked, delayed or
 * refused. Every failure path here (no encryption key configured, no database, the stock is empty, a row
 * that fails to decrypt) falls back the same way, after alerting ops (src/lib/alerts.ts) so a genuinely empty
 * stock gets noticed and refilled.
 */
export async function claimMintKeypair(suffix: string = MINT_SUFFIX): Promise<MintKeypairResult> {
  if (!hasVanityStockKey()) return { keypair: Keypair.generate(), vanity: false };

  let db: Db;
  try {
    db = getDb();
  } catch (err) {
    if (!(err instanceof DbNotConfiguredError)) console.error("[PANDA vanity] stock lookup failed", err instanceof Error ? err.message : err);
    return { keypair: Keypair.generate(), vanity: false };
  }

  try {
    const row = await pgClaimVanityKey(db, suffix);
    if (!row) {
      await alertOps("vanity.stock_empty", { suffix });
      return { keypair: Keypair.generate(), vanity: false };
    }
    const secret = decryptSecretKey(row);
    if (!secret) {
      // Already marked claimed — this one address is lost either way (VANITY_STOCK_KEY changed, or a
      // corrupt row), so falling back is strictly better than failing the launch over it.
      await alertOps("vanity.decrypt_failed", { pubkey: row.pubkey });
      return { keypair: Keypair.generate(), vanity: false };
    }
    void warnIfLow(db, suffix); // fire-and-forget — never delays the launch itself
    return { keypair: Keypair.fromSecretKey(secret), vanity: true };
  } catch (err) {
    console.error("[PANDA vanity] claim failed", err instanceof Error ? err.message : err);
    return { keypair: Keypair.generate(), vanity: false };
  }
}

async function warnIfLow(db: Db, suffix: string): Promise<void> {
  try {
    const remaining = await pgVanityStockCount(db, suffix);
    if (remaining <= LOW_STOCK_THRESHOLD && Date.now() - lastLowStockAlert > LOW_STOCK_ALERT_COOLDOWN_MS) {
      lastLowStockAlert = Date.now();
      await alertOps("vanity.stock_low", { suffix, remaining });
    }
  } catch {
    // Best-effort — the claim above already succeeded regardless.
  }
}
