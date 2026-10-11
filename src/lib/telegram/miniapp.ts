import { createHmac, timingSafeEqual } from "node:crypto";
import { isEnabled } from "@/lib/config/flags";
import type { Db } from "@/lib/db/client";
import { tgAddAlert, tgDeleteAlert, tgUnwatch, tgUserAlerts, tgWatch, tgWatchlist } from "@/lib/db/telegram";
import { currentOf, isCrossed, MAX_ALERTS, MAX_WATCH } from "./alerts";
import { walletKey } from "./link";
import type { CoinInfo, Market } from "./market";

/**
 * The Telegram Mini App's server side (docs/TELEGRAM.md §12). Who is asking is NEVER taken from the browser's word: the
 * app sends Telegram's own `initData`, signed by Telegram with the bot's token, and the server checks that signature
 * and its age before issuing a short session of its own. That session names a TELEGRAM account, never a wallet: the
 * wallet is the one that account linked with /link (its own signature), read from PANDA's records.
 */

type Env = Record<string, string | undefined>;

/** On only with the bot itself on, its own flag on and a token to check signatures with. */
export function miniappEnabled(env: Env = process.env): boolean {
  return isEnabled("TELEGRAM_BOT", env) && isEnabled("TELEGRAM_MINIAPP", env) && !!env.TELEGRAM_BOT_TOKEN?.trim();
}

/** Telegram's `initData` is accepted for an hour after it was issued. */
export const INIT_DATA_MAX_AGE_MS = 60 * 60_000;
/** PANDA's own session, issued after that check. Reopening the app from Telegram issues a new one. */
export const SESSION_TTL_MS = 6 * 60 * 60_000;
const CLOCK_SKEW_MS = 60_000;

export type TgAppUser = { id: number; lang: "en" | "es"; firstName: string };
export type InitDataResult = { ok: true; user: TgAppUser; authDate: number } | { ok: false; error: "invalid" | "expired" };

const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/**
 * Telegram's documented check ("Validating data received via the Mini App"): every field except `hash`, sorted, joined
 * with "\n"; secret = HMAC-SHA256(key "WebAppData", bot token); the hash must equal HMAC-SHA256(secret, that string).
 */
export function verifyInitData(initData: unknown, botToken: string, now: number, maxAgeMs: number = INIT_DATA_MAX_AGE_MS): InitDataResult {
  if (typeof initData !== "string" || initData.length < 20 || initData.length > 4096 || !botToken) return { ok: false, error: "invalid" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: "invalid" };
  const check = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const expected = hmac(hmac("WebAppData", botToken), check);
  if (!sameBytes(expected, Buffer.from(hash, "hex"))) return { ok: false, error: "invalid" };

  const authDate = Number(params.get("auth_date")) * 1000;
  if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + CLOCK_SKEW_MS) return { ok: false, error: "invalid" };
  if (now - authDate > maxAgeMs) return { ok: false, error: "expired" };
  let user: { id?: unknown; language_code?: unknown; first_name?: unknown; is_bot?: unknown };
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (!user || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) return { ok: false, error: "invalid" };
  const lang = typeof user.language_code === "string" && user.language_code.toLowerCase().startsWith("es") ? "es" : "en";
  return { ok: true, user: { id: user.id, lang, firstName: typeof user.first_name === "string" ? user.first_name.slice(0, 64) : "" }, authDate };
}

// ── PANDA's own session: "v1.<telegram id>.<expires at>.<hmac>" ─────────────────────────────────────────────────────
/** The signing key is derived from the bot's token, so it needs no variable of its own and changes if the token does. */
const sessionKey = (botToken: string) => hmac("panda-miniapp-session", botToken);

export function issueSession(telegramId: number, botToken: string, now: number, ttlMs: number = SESSION_TTL_MS): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const body = `v1.${telegramId}.${expiresAt}`;
  return { token: `${body}.${hmac(sessionKey(botToken), body).toString("base64url")}`, expiresAt };
}

export function readSession(token: unknown, botToken: string, now: number): { telegramId: number; expiresAt: number } | null {
  if (typeof token !== "string" || token.length > 200 || !botToken) return null;
  const m = /^(v1\.(\d{1,16})\.(\d{10,16}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  if (!sameBytes(hmac(sessionKey(botToken), m[1]), Buffer.from(m[4], "base64url"))) return null;
  const telegramId = Number(m[2]);
  const expiresAt = Number(m[3]);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0 || expiresAt <= now) return null;
  return { telegramId, expiresAt };
}

/** The session of a request: `Authorization: Bearer <token>`. Null = not signed in (or the app is off). */
export function sessionOf(req: Request, env: Env = process.env, now: number = Date.now()): { telegramId: number } | null {
  if (!miniappEnabled(env)) return null;
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return readSession(header.slice(7).trim(), env.TELEGRAM_BOT_TOKEN!.trim(), now);
}

// ── watchlist and alerts: the bot's own rules (/watch, /alert), same tables, same caps ─────────────────────────────
export type AppDeps = { db: Db; market: Market; now: () => number };
export type AppError = "invalid" | "not_found" | "full" | "exists" | "already_true" | "unavailable";
type Fail = { ok: false; error: AppError };

export type WatchItem = { mint: string; ticker: string | null; name: string | null; image: string | null; priceUsd: number | null; marketCap: number | null; change24h: number | null };

const item = (mint: string, c: CoinInfo | null | undefined, q?: { priceUsd: number | null; marketCap: number | null; ticker?: string | null }): WatchItem => ({
  mint,
  ticker: c?.ticker && c.ticker !== "?" ? c.ticker : q?.ticker ?? null,
  name: c?.name && c.name !== "?" ? c.name : null,
  image: c?.image ?? null,
  priceUsd: c?.priceUsd ?? q?.priceUsd ?? null,
  marketCap: c?.marketCap ?? q?.marketCap ?? null,
  change24h: c?.change24h ?? null,
});

export async function appWatchlist(d: AppDeps, telegramId: number): Promise<WatchItem[]> {
  const mints = await tgWatchlist(d.db, telegramId);
  if (mints.length === 0) return [];
  const quotes = await d.market.quotes(mints).catch(() => new Map());
  const coins = await Promise.all(mints.map((m) => d.market.coin(m).catch(() => null)));
  return mints.map((m, i) => item(m, coins[i], quotes.get(m)));
}

export async function appWatch(d: AppDeps, telegramId: number, rawMint: unknown): Promise<{ ok: true; item: WatchItem } | Fail> {
  const mint = walletKey(rawMint);
  if (!mint) return { ok: false, error: "invalid" };
  const current = await tgWatchlist(d.db, telegramId);
  const c = await d.market.coin(mint).catch(() => null);
  if (!c) return { ok: false, error: "not_found" };
  if (current.includes(mint)) return { ok: false, error: "exists" };
  if (current.length >= MAX_WATCH) return { ok: false, error: "full" };
  await tgWatch(d.db, telegramId, mint, d.now());
  return { ok: true, item: item(mint, c) };
}

export async function appUnwatch(d: AppDeps, telegramId: number, rawMint: unknown): Promise<{ ok: true } | Fail> {
  const mint = walletKey(rawMint);
  if (!mint) return { ok: false, error: "invalid" };
  return (await tgUnwatch(d.db, telegramId, mint)) ? { ok: true } : { ok: false, error: "not_found" };
}

export type AlertItem = { id: string; mint: string; ticker: string; metric: "price" | "mcap"; direction: "above" | "below"; value: number };
const alertItem = (a: { id: string; mint: string; ticker: string; metric: string; direction: string; value: number }): AlertItem => ({
  id: a.id,
  mint: a.mint,
  ticker: a.ticker,
  metric: a.metric === "mcap" ? "mcap" : "price",
  direction: a.direction === "below" ? "below" : "above",
  value: a.value,
});

export async function appAlerts(d: AppDeps, telegramId: number): Promise<AlertItem[]> {
  return (await tgUserAlerts(d.db, telegramId)).map(alertItem);
}

export async function appAddAlert(d: AppDeps, telegramId: number, i: { mint: unknown; metric: unknown; direction: unknown; value: unknown }): Promise<{ ok: true; alert: AlertItem } | (Fail & { current?: number })> {
  const mint = walletKey(i.mint);
  const value = typeof i.value === "number" ? i.value : NaN;
  if (!mint || (i.metric !== "price" && i.metric !== "mcap") || (i.direction !== "above" && i.direction !== "below") || !Number.isFinite(value) || value <= 0 || value > 1e15) return { ok: false, error: "invalid" };
  if ((await tgUserAlerts(d.db, telegramId)).length >= MAX_ALERTS) return { ok: false, error: "full" };
  const c = await d.market.coin(mint).catch(() => null);
  if (!c) return { ok: false, error: "not_found" };
  const spec = { metric: i.metric, direction: i.direction, value } as const;
  // An alert that is already true would fire at once and say nothing useful: refused, as /alert does.
  const current = currentOf({ priceUsd: c.priceUsd, marketCap: c.marketCap }, spec.metric);
  if (current !== null && isCrossed(spec, current)) return { ok: false, error: "already_true", current };
  const row = await tgAddAlert(d.db, { telegramId, mint, ticker: c.ticker.slice(0, 20), ...spec }, d.now());
  return { ok: true, alert: alertItem(row) };
}

export async function appDeleteAlert(d: AppDeps, telegramId: number, id: unknown): Promise<{ ok: true } | Fail> {
  if (typeof id !== "string" || id.length < 1 || id.length > 64) return { ok: false, error: "invalid" };
  return (await tgDeleteAlert(d.db, telegramId, id)) ? { ok: true } : { ok: false, error: "not_found" };
}

// ── the wallet relay: what the wallet app answers travels back to the Mini App ENCRYPTED, through here ─────────────
/**
 * Signing happens in the user's own wallet app (Phantom / Solflare deep links). The wallet answers by opening a PANDA
 * page in the phone's browser — not inside Telegram — so that page hands the answer to the server and the Mini App
 * collects it. The answer is encrypted by the wallet for a key that only the Mini App holds: the server stores it for a
 * few minutes and cannot read it. A slot is opened by a signed-in Mini App, filled once, read once.
 */
export const RELAY_TTL_MS = 10 * 60_000;
export const RELAY_MAX_CHARS = 6_000;
const RELAY_ID = /^[A-Za-z0-9_-]{32}$/;
export const isRelayId = (v: unknown): v is string => typeof v === "string" && RELAY_ID.test(v);
export const relayKey = (id: string) => `relay:${id}`;
export type RelaySlot = { telegramId: number; expiresAt: number; answer: Record<string, string> | null };

/** Only the fields a wallet's redirect can carry, as short strings — nothing else is stored. */
export function cleanRelayAnswer(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  let size = 0;
  for (const k of ["phantom_encryption_public_key", "solflare_encryption_public_key", "nonce", "data", "errorCode", "errorMessage"]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== "string" || !v) continue;
    if (k === "errorMessage") out[k] = v.slice(0, 200);
    else if (/^[A-Za-z0-9_-]{1,5000}$/.test(v)) out[k] = v;
    else return null;
    size += out[k].length;
  }
  return size > 0 && size <= RELAY_MAX_CHARS && ((out.nonce && out.data) || out.errorCode) ? out : null;
}
