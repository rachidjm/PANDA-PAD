import type { Db } from "@/lib/db/client";
import { tgDeleteState, tgGetState, tgGetUser, tgSetState } from "@/lib/db/telegram";
import { verifyInitData } from "./miniapp";

/**
 * PANDA's session inside the Telegram Mini App (docs/TELEGRAM.md §12).
 *
 * WHO it is: the Telegram account that Telegram's own signed `initData` names, acting as the wallet that account
 * linked with /link — a link the wallet itself signed, once, and that only that wallet can make. So signing in here
 * asks the wallet for nothing: Telegram proves the account, PANDA's own record gives the wallet.
 *
 * WHAT it can do: nothing that moves money. It is accepted ONLY by the routes that ask for it by name
 * (`getSession(req, { linked: true })`): reading the wallet's own orders, and the order routes in which every change
 * is a transaction the wallet signs or a fact read back from the chain. Buying, selling, creating a coin and creating,
 * changing or cancelling an order all still need the wallet app's signature — there is no route where this session
 * stands in for it. Every other signed-in route of the website (rewards, claims, referrals, the market, /admin)
 * does not see it at all.
 *
 * HOW LONG: 30 minutes from the last use, wherever the user went meanwhile (the wallet app, another app, a locked
 * phone, Telegram reloading the Mini App) — it lives on the server, keyed by the Telegram account, so there is nothing
 * to lose on the phone. Twelve hours at the very most. Unlinking the wallet, or linking another, ends it at once.
 */

export const APP_SESSION_IDLE_MS = 30 * 60_000;
export const APP_SESSION_MAX_MS = 12 * 60 * 60_000;
/** Telegram's data is issued once per opening of the app: a request made hours into that opening still carries it. */
export const APP_INIT_DATA_MAX_AGE_MS = 24 * 60 * 60_000;
/** The last use is written at most this often (one small update, not one per request). */
const TOUCH_EVERY_MS = 60_000;
export const APP_SESSION_HEADER = "x-panda-app-session";
export const APP_INIT_DATA_HEADER = "x-tg-init-data";

export type LoginDeps = { db: Db; now: () => number; botToken: string };
type State = { wallet: string; startedAt: number; lastActive: number };
const key = (telegramId: number) => `appsess:tg:${telegramId}`;
const expiryOf = (s: State) => Math.min(s.lastActive + APP_SESSION_IDLE_MS, s.startedAt + APP_SESSION_MAX_MS);

export type AppSessionInfo = { wallet: string; expiresAt: number; startedAt: number };

/** "Sign in": for a Telegram account with a linked wallet, and only for that wallet. No signature is asked for. */
export async function startAppSession(d: Pick<LoginDeps, "db" | "now">, telegramId: number): Promise<({ ok: true } & AppSessionInfo) | { ok: false; error: "not_linked" }> {
  const wallet = (await tgGetUser(d.db, telegramId))?.wallet ?? null;
  if (!wallet) return { ok: false, error: "not_linked" };
  const now = d.now();
  const state: State = { wallet, startedAt: now, lastActive: now };
  await tgSetState(d.db, key(telegramId), state, now);
  return { ok: true, wallet, startedAt: now, expiresAt: expiryOf(state) };
}

/**
 * The live session of a Telegram account, or null: never started, signed out, unused for 30 minutes, older than its
 * maximum, or for a wallet that is no longer the one linked. `touch` counts this as a use.
 */
export async function appSessionOf(d: Pick<LoginDeps, "db" | "now">, telegramId: number, touch = true): Promise<AppSessionInfo | null> {
  const state = await tgGetState<State>(d.db, key(telegramId));
  if (!state || typeof state.wallet !== "string") return null;
  const now = d.now();
  if (now >= expiryOf(state)) {
    await tgDeleteState(d.db, key(telegramId));
    return null;
  }
  if ((await tgGetUser(d.db, telegramId))?.wallet !== state.wallet) {
    await tgDeleteState(d.db, key(telegramId));
    return null;
  }
  let live = state;
  if (touch && now - state.lastActive >= TOUCH_EVERY_MS) {
    live = { ...state, lastActive: now };
    await tgSetState(d.db, key(telegramId), live, now);
  }
  return { wallet: live.wallet, startedAt: live.startedAt, expiresAt: expiryOf(live) };
}

/** "Sign out". True if there was a session. */
export async function closeAppSession(d: Pick<LoginDeps, "db">, telegramId: number): Promise<boolean> {
  const had = !!(await tgGetState<State>(d.db, key(telegramId)));
  if (had) await tgDeleteState(d.db, key(telegramId));
  return had;
}

/**
 * The check behind every request the Mini App makes to one of the website's routes: Telegram's own signed data (its
 * signature is verified here, every time — the browser's word is never taken), and that account's live session.
 */
export async function appWalletSession(d: LoginDeps, initData: unknown): Promise<{ wallet: string; telegramId: number; issuedAt: number } | null> {
  const tg = verifyInitData(initData, d.botToken, d.now(), APP_INIT_DATA_MAX_AGE_MS);
  if (!tg.ok) return null;
  const s = await appSessionOf(d, tg.user.id);
  return s ? { wallet: s.wallet, telegramId: tg.user.id, issuedAt: s.startedAt } : null;
}
