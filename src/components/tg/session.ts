/**
 * The Mini App's PANDA session, on the phone (the server's side is src/lib/telegram/app-login.ts).
 *
 * It lives in this module's memory and nowhere else: not in the browser's storage, not in a cookie. Closing the app
 * destroys the page and the session with it; the shell also tells the server to end it. While it exists, every request
 * the app makes to PANDA carries it in a header, together with Telegram's own signed data — that is what makes the
 * website's own panels (buy, sell, Draw Your Trade, orders, create) work here without ever asking to sign in again.
 *
 * The one thing written to the phone is a one-time TICKET, and only while the wallet app is open: Telegram sometimes
 * restarts the Mini App on the way back, and the ticket is what lets the server hand the same session back. It is
 * removed the moment the wallet step ends, is useless after a few minutes, and cannot be used once the session was closed.
 */

export type AppSession = { token: string; jti: string; resume: string; wallet: string; expiresAt: number };

const HEADER = "x-panda-app-session";
const INIT_DATA_HEADER = "x-tg-init-data";
const TICKET_KEY = "panda.tg.ticket";
const TICKET_MAX_AGE_MS = 5 * 60_000;
/** A wallet step is over after this long even if nobody said so (the adapter stops waiting at two minutes). */
const TRIP_MAX_MS = 150_000;

let current: AppSession | null = null;
let initData = "";
let tripUntil = 0;
let holdUntil = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export const appSession = {
  get: (): AppSession | null => (current && current.expiresAt > Date.now() ? current : null),
  set(next: AppSession | null) {
    current = next;
    clearTimeout(expiry);
    // It ends by itself after its few hours, even if the app is never closed.
    if (next) expiry = setTimeout(() => appSession.set(null), Math.max(0, Math.min(next.expiresAt - Date.now(), 2 ** 31 - 1)));
    tell();
  },
  setInitData(v: string) {
    initData = v;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** What a request to PANDA carries while signed in. Empty when not. */
  headers(): Record<string, string> {
    const s = appSession.get();
    return s && initData ? { [HEADER]: s.token, [INIT_DATA_HEADER]: initData } : {};
  },
};

type Ticket = { jti: string; resume: string; at: number };

/** The wallet app is about to open: the page may be frozen, or even restarted, until the user is back. */
export function startWalletTrip(now: number = Date.now()): void {
  tripUntil = now + TRIP_MAX_MS;
  const s = appSession.get();
  if (!s) return;
  try {
    localStorage.setItem(TICKET_KEY, JSON.stringify({ jti: s.jti, resume: s.resume, at: now } satisfies Ticket));
  } catch {}
}

export function endWalletTrip(): void {
  tripUntil = 0;
  try {
    localStorage.removeItem(TICKET_KEY);
  } catch {}
}

/**
 * The phone's own gallery or camera is about to cover the app (choosing a coin's picture): like a wallet step, that is
 * not leaving. No ticket is written — the app is not going anywhere. Released the moment the app is on screen again.
 */
export function holdSession(ms: number = 3 * 60_000, now: number = Date.now()): void {
  holdUntil = now + ms;
}
export function releaseHold(): void {
  holdUntil = 0;
}

export const inWalletTrip = (now: number = Date.now()) => now < tripUntil || now < holdUntil;

/** The ticket left by a wallet step, read ONCE (it is removed here) and only while it is young. */
export function takeTicket(now: number = Date.now()): { jti: string; resume: string } | null {
  try {
    const raw = localStorage.getItem(TICKET_KEY);
    localStorage.removeItem(TICKET_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<Ticket>) : null;
    if (!v || typeof v.jti !== "string" || typeof v.resume !== "string" || typeof v.at !== "number" || now - v.at > TICKET_MAX_AGE_MS) return null;
    return { jti: v.jti, resume: v.resume };
  } catch {
    return null;
  }
}

/** PANDA's own API, on this site — except the Mini App's own routes, which carry the Telegram session themselves. */
export function wantsSession(url: string, origin: string): boolean {
  try {
    const u = new URL(url, origin);
    return u.origin === origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/tg/");
  } catch {
    return false;
  }
}

/**
 * Every request the page makes to PANDA's API carries the session while there is one. Installed once by the shell;
 * returns the way to undo it. Nothing else about a request changes.
 */
export function installSessionFetch(win: Window & typeof globalThis = window): () => void {
  const original = win.fetch;
  const patched: typeof fetch = (input, init) => {
    const extra = appSession.headers();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (Object.keys(extra).length === 0 || !wantsSession(url, win.location.origin)) return original.call(win, input, init);
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return original.call(win, input, { ...init, headers });
  };
  win.fetch = patched;
  return () => {
    if (win.fetch === patched) win.fetch = original;
  };
}
