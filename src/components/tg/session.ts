/**
 * PANDA's session inside the Mini App, as the phone sees it (the session itself is on the server:
 * src/lib/telegram/app-login.ts).
 *
 * There is nothing to keep here and nothing to lose: the session belongs to the Telegram account and lives on the
 * server for 30 minutes after its last use, so it is still there after a trip to the wallet app, another app, a locked
 * phone or Telegram reloading the Mini App. This module only remembers, while the page is alive, THAT there is one —
 * and makes every request the page sends to PANDA's own API carry Telegram's signed data, which is what the server
 * checks. No token, no cookie, nothing in the browser's storage.
 */

export type AppSession = { wallet: string; expiresAt: number };

const HEADER = "x-panda-app-session";
const INIT_DATA_HEADER = "x-tg-init-data";

let current: AppSession | null = null;
let initData = "";
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());

export const appSession = {
  get: (): AppSession | null => current,
  /** `null`: signed out, or the server said the session is over. */
  set(next: AppSession | null) {
    current = next;
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
    return current && initData ? { [HEADER]: "1", [INIT_DATA_HEADER]: initData } : {};
  },
};

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
