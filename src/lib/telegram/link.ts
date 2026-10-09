import { createHash, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { verifyEd25519 } from "@/lib/auth/wallet-auth";
import type { Db } from "@/lib/db/client";
import { tgGetLinkCode, tgInsertLinkCode, tgLinkWallet } from "@/lib/db/telegram";

/**
 * Telegram ↔ wallet linking (docs/TELEGRAM.md §4). The same pattern as PANDA's wallet sign-in (src/lib/auth/wallet-auth.ts):
 * a one-time secret the SERVER stores, a message the server REBUILDS from its own record (the browser can't change what was
 * signed), an ed25519 check of the wallet's signature, and an atomic burn. The sign-in message itself can't be reused as is:
 * it doesn't name the Telegram account, so this one adds the Telegram id and the /link code.
 *
 * What the user signs names: the domain, the wallet, the Telegram id, the code, whether it replaces another account's link,
 * and when it was issued / expires. Only the code's SHA-256 is stored. Nothing here ever asks for a seed phrase or a key.
 */

export const LINK_TTL_MS = 10 * 60_000;
const CODE_RE = /^[A-Za-z0-9_-]{24}$/;

export const isLinkCode = (v: unknown): v is string => typeof v === "string" && CODE_RE.test(v);
export const hashLinkCode = (code: string) => createHash("sha256").update(`panda-tg-link.${code}`).digest("hex");

export async function createLinkCode(db: Db, telegramId: number, now: number): Promise<{ code: string; expiresAt: number }> {
  const code = randomBytes(18).toString("base64url"); // 24 chars
  const expiresAt = now + LINK_TTL_MS;
  await tgInsertLinkCode(db, hashLinkCode(code), telegramId, now, expiresAt);
  return { code, expiresAt };
}

export function buildLinkMessage(p: { domain: string; wallet: string; telegramId: number; code: string; replace: boolean; issuedAt: number; expiresAt: number }): string {
  return [
    "PANDA wants to link your Telegram account to this wallet.",
    "",
    `Domain: ${p.domain}`,
    `Wallet: ${p.wallet}`,
    `Telegram ID: ${p.telegramId}`,
    `Code: ${p.code}`,
    `Replace the Telegram account currently linked to this wallet: ${p.replace ? "yes" : "no"}`,
    `Issued At: ${new Date(p.issuedAt).toISOString()}`,
    `Expires At: ${new Date(p.expiresAt).toISOString()}`,
    "",
    "Signing is free and does not move any funds. PANDA will never ask for your seed phrase or private key.",
  ].join("\n");
}

export function walletKey(v: unknown): string | null {
  if (typeof v !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return null;
  try {
    return new PublicKey(v).toBase58();
  } catch {
    return null;
  }
}

export type LinkError = "invalid" | "code_used_or_expired" | "bad_signature" | "linked_elsewhere";

/** The exact message the user must sign for this code + wallet (from the server's own record), or why there is none. */
export async function linkMessageFor(db: Db, i: { code: unknown; wallet: unknown; replace: boolean; domain: string; now: number }): Promise<{ ok: true; message: string; telegramId: number } | { ok: false; error: LinkError }> {
  const wallet = walletKey(i.wallet);
  if (!isLinkCode(i.code) || !wallet) return { ok: false, error: "invalid" };
  const rec = await tgGetLinkCode(db, hashLinkCode(i.code));
  if (!rec || rec.usedAt !== null || rec.expiresAt <= i.now) return { ok: false, error: "code_used_or_expired" };
  return { ok: true, telegramId: rec.telegramId, message: buildLinkMessage({ domain: i.domain, wallet, telegramId: rec.telegramId, code: i.code, replace: i.replace, issuedAt: rec.createdAt, expiresAt: rec.expiresAt }) };
}

/**
 * Verifies the signature over the message rebuilt from the server's record, then burns the code and links (one transaction).
 * Fails for: an unknown / used / expired code, a signature by another wallet, a signature over a message for another
 * Telegram id, another domain or another code, and a wallet already linked elsewhere without `replace`.
 */
export async function completeLink(
  db: Db,
  i: { code: unknown; wallet: unknown; signature: unknown; replace: boolean; domain: string; now: number }
): Promise<{ ok: true; telegramId: number; wallet: string; previousTelegramId: number | null } | { ok: false; error: LinkError }> {
  const wallet = walletKey(i.wallet);
  if (!isLinkCode(i.code) || !wallet || typeof i.signature !== "string" || i.signature.length > 200) return { ok: false, error: "invalid" };
  let sig: Uint8Array;
  try {
    sig = bs58.decode(i.signature);
  } catch {
    return { ok: false, error: "invalid" };
  }
  const built = await linkMessageFor(db, { code: i.code, wallet, replace: i.replace, domain: i.domain, now: i.now });
  if (!built.ok) return built;
  if (!verifyEd25519(new TextEncoder().encode(built.message), sig, new PublicKey(wallet).toBytes())) return { ok: false, error: "bad_signature" };
  const r = await tgLinkWallet(db, { codeHash: hashLinkCode(i.code), telegramId: built.telegramId, wallet, replace: i.replace, now: i.now });
  if (!r.ok) return { ok: false, error: r.reason };
  return { ok: true, telegramId: built.telegramId, wallet, previousTelegramId: r.previousTelegramId };
}
